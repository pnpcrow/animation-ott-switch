# Post-hoc title recovery diagnostic

Strict element selection and usable title text are different outcomes. A model can select a decorated OG/document title instead of the annotated clean heading, yet an existing normalizer may recover the same title. `scripts/title-recovery-tiny-decisions.mjs` measures that limited possibility without changing the original gold, element-selection scores, model prompts or application source.

The script loads the existing `src/providers/identity.ts` implementation through the already installed esbuild dependency and records its source hash. For the selected frozen title candidate it calls `cleanPageTitle` with the observed provider/source type and **empty references**; it then uses `isWorkTitle` and `normalizeTitle` for equality. No reference title, alternate title or evaluated-model prediction is supplied as a cleaning hint. The comparison target comes exclusively from the frozen positive title node after candidate processing.

Two columns distinguish the source of the candidate text:

- `rawTitleRecoverable`: the selected element's value retained in the frozen DOM observation.
- `visibleTitleRecoverable`: only the bounded value included in the model's option text.

`rescuedElementMistakes` counts cases whose selected element was wrong under the original gold but whose normalized title matches. Errors, invalid selections and model abstentions remain failures among positive-title cases. Cases with no open work detail have **no title-recovery score**. They are reported separately as correct abstentions, incorrect selections and work-like strings surviving cleaning; a plausible string does not establish a current work.

Only original real-DOM title case IDs enter this diagnostic. Other fields and synthetic/compact/stress case IDs are out of scope. Each template/split stays separate. Partial source files require explicit `--allow-partial=true` and are labeled provisional; completed calibration remains calibration, not holdout evidence. This diagnostic does not select a new template.

Existing title normalization removes provider/Watch decoration, punctuation and subtitle/dub badges, while retaining season/part distinctions according to the current application rules. Thus recovery is not proof of the same edition, season, availability, successful search or safe navigation. It also does not demonstrate that the model selected the right active modal. It supplements strict element accuracy rather than replacing it.

```sh
node scripts/title-recovery-tiny-decisions.mjs --reports=eval/tiny-decision/reports/jev-calibration.json,eval/tiny-decision/results/slayer-holdout-raw.json --output=eval/tiny-decision/reports/title-recovery.json
node --test eval/tiny-decision/title-recovery.test.mjs
```

Rerun with explicit completed holdout report paths when those files become available. The script only reads saved predictions; it performs no model inference or page actions.
