"""Development-motivated fourth condition; reuse frozen original implementation."""
import copy
import sys
import time
from pathlib import Path

ORIGINAL = Path('eval/dom-scale/model')
FOLLOWUP = Path('eval/dom-scale/followup')
sys.path.insert(0, str(ORIGINAL.resolve()))
import shared
import train
import export
import predict

RECIPE = {'layers': [2, 5, 8, 11], 'maximumTokens': 384}
REASON = ('Post-development follow-up: both original compact conditions selected none '
          'for all 57 validation cases. Add four-layer natural input to isolate depth '
          'reduction from the failed compact representation; no held-out data observed.')


def verify_original():
    freeze = export.verify_freeze(ORIGINAL / 'model-freeze.json')
    assert shared.digest(ORIGINAL / 'training.json') == freeze['trainingSha256']
    assert shared.digest(ORIGINAL / 'design.json') == freeze['designSha256']
    return freeze, shared.read(ORIGINAL / 'design.json')


def activate():
    # All imported modules refer to this same dictionary. No original source is edited.
    shared.RECIPES.clear()
    shared.RECIPES['small-natural'] = copy.deepcopy(RECIPE)


def verify_wrapper():
    manifest = shared.read(FOLLOWUP / 'source-wrapper-manifest.json')
    for source, expected in manifest['hashes'].items():
        assert shared.digest(source) == expected, source
    assert shared.digest(ORIGINAL / 'model-freeze.json') == manifest['originalModelFreezeSha256']
    return manifest


def selection():
    original = shared.read(ORIGINAL / 'training.json')
    followup = shared.read(FOLLOWUP / 'training.json')
    rows = original['recipes'] + followup['recipes']
    ranked = sorted(rows, key=lambda row: (-row['validationScore']['correct'],
                    row['validationScore']['falseSelections'], row['parameters'], row['recipe']))
    shared.write(FOLLOWUP / 'selection.json', {
        'schemaVersion': 1,
        'selectionRule': shared.read(ORIGINAL / 'design.json')['selection'],
        'basis': 'Original fixed development validation only; final epoch fp32; holdout remains unseen.',
        'postDevelopmentFollowup': True, 'reason': REASON,
        'originalTrainingSha256': shared.digest(ORIGINAL / 'training.json'),
        'followupTrainingSha256': shared.digest(FOLLOWUP / 'training.json'),
        'selected': ranked[0]['recipe'],
        'selectedCompactArchitecture': next(row['recipe'] for row in ranked if row['parameters'] == 7738369),
        'ranking': [{'recipe': row['recipe'], 'parameters': row['parameters'],
                     'validationScore': row['validationScore']} for row in ranked],
        'frozenAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    })


def run_training(original_design):
    # Do not overwrite a completed follow-up or silently change its plan after results.
    if (FOLLOWUP / 'source-wrapper-manifest.json').exists():
        raise ValueError('Follow-up source/design already frozen; refuse to start another run')
    plans = Path(sys.argv[sys.argv.index('--plans') + 1])
    natural = shared.read(plans / 'small-natural.json')
    expected = shared.read('.tmp/dom-scale/model/plans/full-natural.json')
    expected['recipe'] = 'small-natural'
    expected['layers'] = RECIPE['layers']
    assert natural == expected, 'Natural text/order/budget must match original exactly'
    assert shared.digest(plans / 'full-compact.json') == original_design['plans']['full-compact']
    wrapper_sources = [FOLLOWUP / 'pipeline.py', FOLLOWUP / 'prepare-inputs.mjs']
    manifest = {
        'schemaVersion': 1, 'hashes': {str(path).replace('\\', '/'): shared.digest(path) for path in wrapper_sources},
        'originalModelFreezeSha256': shared.digest(ORIGINAL / 'model-freeze.json'),
        'originalDesignSha256': shared.digest(ORIGINAL / 'design.json'),
        'originalTrainingSha256': shared.digest(ORIGINAL / 'training.json'),
        'postDevelopmentFollowup': True, 'reason': REASON,
        'recipe': {'small-natural': RECIPE},
        'frozenAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    shared.write(FOLLOWUP / 'source-wrapper-manifest.json', manifest)
    original_write = train.write

    def annotated_write(path, value):
        if Path(path).name == 'design.json':
            assert value['split'] == original_design['split'], 'Original work split must remain identical'
            assert value['optimizer'] == original_design['optimizer']
            assert value['data'] == original_design['data']
            assert value['seed'] == original_design['seed']
            value['postDevelopmentFollowup'] = {'reason': REASON,
                'sourceWrapperManifestSha256': shared.digest(FOLLOWUP / 'source-wrapper-manifest.json'),
                'originalDesignSha256': shared.digest(ORIGINAL / 'design.json'),
                'originalModelFreezeSha256': shared.digest(ORIGINAL / 'model-freeze.json'),
                'exactNaturalInputExceptRecipeAndLayers': True}
            for source in wrapper_sources + [FOLLOWUP / 'source-wrapper-manifest.json']:
                value['sources'][str(source).replace('\\', '/')] = shared.digest(source)
        if Path(path).name == 'model-freeze.json':
            value['holdoutStatus'] = 'Development-motivated fourth condition frozen; no held-out inputs, labels or results read.'
            value['postDevelopmentFollowup'] = True
        original_write(path, value)

    train.write = annotated_write
    train.main()
    original = shared.read(ORIGINAL / 'full-natural-training.json')
    result = shared.read(FOLLOWUP / 'small-natural-training.json')
    assert result['caseOrder'] == original['caseOrder'], 'Training case order changed'
    selection()


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ['train', 'export', 'predict']:
        raise SystemExit('pipeline.py {train|export|predict} <original runner arguments>')
    action = sys.argv.pop(1)
    _, original_design = verify_original()
    activate()
    if action == 'train':
        assert '--output' in sys.argv and Path(sys.argv[sys.argv.index('--output') + 1]) == FOLLOWUP
        run_training(original_design)
    else:
        verify_wrapper()
        if action == 'export':
            assert '--output' in sys.argv and Path(sys.argv[sys.argv.index('--output') + 1]) == FOLLOWUP
            export.main()
        else:
            assert '--model-dir' in sys.argv and Path(sys.argv[sys.argv.index('--model-dir') + 1]) == FOLLOWUP
            predict.main()


if __name__ == '__main__':
    main()
