"""Closed suffix probabilities, sharing the prompt KV prefill; no text generation."""
import copy
import torch


@torch.inference_mode()
def suffix_scores(model, tokenizer, prompt, count, index_base=1, max_tokens=4096):
    ids = tokenizer.encode(prompt, add_special_tokens=False)
    suffixes = []
    for index in range(index_base, index_base + count):
        full = tokenizer.encode(prompt + f"{index}]", add_special_tokens=False)
        if full[:len(ids)] != ids:
            raise ValueError("Tokenizer changed the prompt at the answer boundary")
        suffixes.append(full[len(ids):])
    if len(ids) + max(map(len, suffixes)) > max_tokens:
        raise ValueError(f"Context overflow: {len(ids)} prompt tokens; no truncation applied")
    device = next(model.parameters()).device
    input_ids = torch.tensor([ids], device=device)
    output = model(input_ids=input_ids, use_cache=True, logits_to_keep=1)
    root = output.logits[0, -1].float().log_softmax(-1)
    node_probs = {(): root}
    nodes = {tuple(suffix[:depth]) for suffix in suffixes for depth in range(1, len(suffix))}
    for depth in sorted({len(node) for node in nodes}):
        prefixes = sorted(node for node in nodes if len(node) == depth)
        cache = copy.deepcopy(output.past_key_values)
        cache.batch_repeat_interleave(len(prefixes))
        branch = model(
            input_ids=torch.tensor(prefixes, device=device),
            past_key_values=cache,
            attention_mask=torch.ones((len(prefixes), len(ids) + depth), dtype=torch.long, device=device),
            position_ids=torch.arange(len(ids), len(ids) + depth, device=device).repeat(len(prefixes), 1),
            use_cache=True,
            logits_to_keep=1,
        )
        for prefix, logits in zip(prefixes, branch.logits[:, -1]):
            node_probs[prefix] = logits.float().log_softmax(-1)
    scores = torch.stack([sum(node_probs[tuple(s[:i])][token] for i, token in enumerate(s)) for s in suffixes])
    return {
        "probabilities": scores.softmax(-1).tolist(),
        "logScores": scores.tolist(),
        "legalRootMass": root[sorted({s[0] for s in suffixes})].exp().sum().item(),
        "promptTokens": len(ids),
        "suffixTokens": suffixes,
    }


@torch.inference_mode()
def full_reference_scores(model, tokenizer, prompt, count, index_base=1):
    """Slow full-sequence reference for testing shared-cache numerical parity."""
    prefix = tokenizer.encode(prompt, add_special_tokens=False)
    scores = []
    for index in range(index_base, index_base + count):
        ids = tokenizer.encode(prompt + f"{index}]", add_special_tokens=False)
        if ids[:len(prefix)] != prefix:
            raise ValueError("Prompt token boundary changed")
        suffix_length = len(ids) - len(prefix)
        out = model(torch.tensor([ids[:-1]]), use_cache=False, logits_to_keep=suffix_length)
        logp = out.logits[0].float().log_softmax(-1)
        scores.append(sum(logp[pos - len(prefix), ids[pos]].item() for pos in range(len(prefix), len(ids))))
    return scores
