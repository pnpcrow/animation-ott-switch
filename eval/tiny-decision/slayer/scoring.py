"""Exact closed-option suffix scores with shared causal prefix for Slayer.

The upstream HF wrapper returns no KV cache. This inference-only adapter uses
the same modules and equations, caching each layer's rotated keys and values.
No weights, logits or scores are trained or heuristically altered.
"""
import torch
from torch.nn import functional as F


@torch.inference_mode()
def advance(model, token_ids, previous=None, offset=0):
    x = model.model.embed_tokens(token_ids)
    batch, length, _ = x.shape
    config = model.config
    dim = config.head_dim
    theta = config.rope_parameters.get("rope_theta", 10000.0)
    inv = 1.0 / theta ** (torch.arange(0, dim, 2, device=x.device, dtype=torch.float32) / dim)
    positions = torch.arange(offset, offset + length, device=x.device)[None]
    phase = positions.float().unsqueeze(-1) * inv
    phase = torch.cat((phase, phase), -1)
    cos, sin = phase.cos()[:, None].to(x.dtype), phase.sin()[:, None].to(x.dtype)
    first_value = None
    cache = []
    for index, layer in enumerate(model.model.layers):
        attn = layer.self_attn
        normalized = layer.input_layernorm(x)
        q = attn.q_norm(attn.q_proj(normalized).view(batch, length, attn.heads, dim)).transpose(1, 2)
        k = attn.k_norm(attn.k_proj(normalized).view(batch, length, attn.kv, dim)).transpose(1, 2)
        v = attn.v_proj(normalized)
        if attn.first:
            first_value = v
        else:
            v = v + attn.v_proj.vr_lambda * first_value
        v = v.view(batch, length, attn.kv, dim).transpose(1, 2)
        def rotate(z):
            return torch.cat((-z[..., dim // 2:], z[..., :dim // 2]), -1)
        q, k = q * cos + rotate(q) * sin, k * cos + rotate(k) * sin
        if previous is not None:
            old_k, old_v = previous[index]
            k = torch.cat((old_k, k), -2)
            v = torch.cat((old_v, v), -2)
        cache.append((k, v))
        repeats = attn.heads // attn.kv
        key = k.repeat_interleave(repeats, 1)
        value = v.repeat_interleave(repeats, 1)
        if previous is None:
            output = F.scaled_dot_product_attention(q, key, value, is_causal=True)
        else:
            # Trie increments are one token; it can attend to all prefix keys.
            if length != 1:
                raise ValueError("Cached increments must contain one token")
            output = F.scaled_dot_product_attention(q, key, value, is_causal=False)
        output = attn.o_proj(output.transpose(1, 2).contiguous().view(batch, length, -1))
        x = x + output
        x = x + layer.mlp(layer.post_attention_layernorm(x))
    logits = model.lm_head(model.model.norm(x[:, -1:, :]))[:, -1].float()
    return logits.log_softmax(-1)[0], cache


@torch.inference_mode()
def suffix_scores(model, tokenizer, prompt, option_count, index_base=0, reference=False):
    prefix = tokenizer.encode(prompt, add_special_tokens=False)
    tails = [tokenizer.encode(f"{i + index_base}]", add_special_tokens=False) for i in range(option_count)]
    for i, tail in enumerate(tails):
        if tokenizer.encode(prompt + f"{i + index_base}]", add_special_tokens=False) != prefix + tail:
            raise ValueError("Candidate suffix changes the tokenization of the prompt boundary")
    if not prefix or not tails or any(not tail for tail in tails):
        raise ValueError("Empty prefix or legal suffix")
    needed = len(prefix) + max(map(len, tails))
    if needed > model.config.max_position_embeddings:
        raise ValueError(f"Context budget exceeded: {needed} > {model.config.max_position_embeddings}; no truncation performed")
    prefix_tensor = torch.tensor([prefix], dtype=torch.long)
    initial, cache = advance(model, prefix_tensor)
    trie = {}
    for index, tokens in enumerate(tails):
        node = trie
        for token in tokens:
            node = node.setdefault(token, {})
        node[None] = index
    scores = [None] * option_count
    def visit(node, log_probs, kv, depth, total):
        for token, child in node.items():
            if token is None:
                scores[child] = total
                continue
            score = total + log_probs[token].item()
            if list(child) == [None]:
                scores[child[None]] = score
            else:
                next_probs, next_cache = advance(model, torch.tensor([[token]]), kv, len(prefix) + depth)
                visit(child, next_probs, next_cache, depth + 1, score)
    visit(trie, initial, cache, 0, 0.0)
    maximum_error = None
    if reference:
        reference_scores = []
        for tail in tails:
            sequence = torch.tensor([prefix + tail])
            logits = model(sequence).logits.float().log_softmax(-1)
            reference_scores.append(sum(logits[0, len(prefix) + i - 1, token].item() for i, token in enumerate(tail)))
        maximum_error = max(abs(a - b) for a, b in zip(reference_scores, scores))
        if maximum_error > 0.001:
            raise AssertionError(f"Cached readout disagrees with official HF wrapper: {maximum_error}")
    root_tokens = sorted({tail[0] for tail in tails})
    legal_root_mass = initial[root_tokens].exp().sum().item()
    joint_suffix_log_mass = torch.logsumexp(torch.tensor(scores, dtype=torch.float64), dim=0).item()
    return {"logScores": scores, "probabilities": torch.softmax(torch.tensor(scores), 0).tolist(), "legalRootMass": legal_root_mass, "legalRootTokenIds": root_tokens, "jointSuffixLogMass": joint_suffix_log_mass, "promptTokens": len(prefix), "suffixTokenIds": tails, "referenceMaxAbsError": maximum_error}
