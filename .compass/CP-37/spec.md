# CP-37: Vietnamese writing rules can change the meaning they are meant to clarify
Loại: feature-m
Phạm vi: writing-vi.md, SKILL.md
Kiểm bằng: mắt
Gốc soi: 0ac9127

## Mục tiêu

`writing-vi.md` teaches agents to imitate its before/after pairs, but several pairs improve the prose
by inventing measurements, implementation details, causes, or certainty that are absent from the bad
sentence. The guide also contains three smaller conflicts: it demands a yes/no answer even when the
answer is unknown, changes "the user" into "you", and disagrees with `SKILL.md` about whether separate
items belong in bullets or prose.

Revise the guide so that natural Vietnamese never comes at the cost of factual fidelity. An agent
following it must preserve the source's subject, facts, scope, causality, and confidence; when those
are weak or unknown, it must expose that limitation instead of filling the gap with plausible detail.

## Ràng buộc

- Add one explicit rule near the top: editing may remove padding and reorder information, but must not
  add a fact, measurement, cause, consequence, actor, or stronger confidence unless evidence supports
  it. This rule outranks style preferences. Reflect it in the priority line, before "dễ hiểu".
- The paired examples are training data, not decoration. Each ❌ → ✅ pair must retain the same factual
  payload and confidence, except when the lesson itself is to call out missing evidence. Audit every
  existing pair, not only the examples named below.
- In the "Trả lời trước" principle, require a direct opening rather than a forced yes/no. If evidence
  is insufficient, "Chưa xác nhận được" or its concrete equivalent is the direct answer.
- Keep the guide's current conversational voice and paired-example form. Do not turn it into policy or
  legal prose.
- Fix the data-flow pair around `syncEvents`: the good version currently introduces a 15-minute
  schedule and a stored `deltaToken` that the bad version never states. Either carry those verified
  facts in both sides or remove them from both.
- Fix the padding pair around "Gate chạy đúng, 576 test xanh": passing 576 tests is evidence about the
  observed run, not proof that the gate is generally correct or stable. The pair must preserve that
  distinction.
- Fix the pronoun pair so "người dùng" does not become "bạn" unless the reader is the affected user.
  Prefer a concrete subject, but do not change who bears the effect.
- Replace absolute word bans such as "bỏ hết" with an operational test: remove filler when meaning is
  unchanged; otherwise retain it or replace it with a concrete subject, scope, or confidence level.
  The rule must still reject genuine padding rather than weakening into "anything is allowed".
- Reconcile list guidance. `writing-vi.md` and `SKILL.md` must both say: use prose for a connected
  argument; use bullets for independently actionable or scannable items; use a table when comparable
  items share multiple dimensions. The number of items alone does not choose the format.
- Preserve the special scopes of Parts 3, 7, and 8: conversational prose, technical findings, and text
  sent outside the work session remain distinct. Do not weaken the evidence requirements for
  `investigation.md` or `spec.md`.
- Keep technical terms that the project already uses (`gate`, `parser`, `cache`, `commit`, and similar)
  rather than translating them mechanically.
- If the edit changes the count of ❌ → ✅ pairs, update the count in `SKILL.md` to the exact value.
  If no pair is added or removed, keep 47.
- Add a section on sentence rhythm to `writing-vi.md`: lead-in phrases before a paragraph
  ("Nói gọn:", "Nói thẳng:", "Nói công bằng:"), rhetorical questions ("Thấy quy luật chưa?"),
  self-commentary, and restating the opening point at the end. Part 4 item 5 already covers
  English structure inside one sentence; the new section covers English discourse rhythm across
  sentences. Each fault gets a ❌ → ✅ pair. The pairs must obey the fidelity rule above.
- Add a numeric length cap to the language section of `SKILL.md`: a conversational reply to a
  simple question is at most 5 sentences unless the user asks for detail. State the number; do
  not write "keep it short". Note the exemption for spec.md and investigation.md.
- This is a documentation-only task. Do not change runtime code, tests, templates, or generated
  `review-brief.md` files.

## Rủi ro hồi quy

- A broad "never add information" sentence could forbid useful explanations and examples. The actual
  boundary is evidence: new context is allowed when it is known and relevant, but a rewrite must not
  manufacture it merely to make the good example more concrete.
- Weakening absolute bans could bring back padded machine prose. The replacement must give an agent a
  test it can apply, not merely say that exceptions exist.
- Changing the yes/no principle could reintroduce long preambles. "Chưa xác nhận được" must still
  appear in the opening sentence, followed by the missing check or evidence.
- Keeping "người dùng" everywhere would be equally mechanical. The rule is to preserve the affected
  actor, while "bạn" remains correct when addressing that actor directly.
- Aligning bullet guidance must not make every response a list. Connected claims with causal words
  such as "vì", "nên", and "nhưng" still belong in prose.
- Parts 7 and 8 deliberately differ: investigation records retain full evidence; outward-facing text
  keeps only what the reader needs for a decision. Editing the general rules must not erase that
  distinction.
- A sentence cap could push an agent to drop a caveat it must state. The cap applies to simple
  questions; a reply that must report an uncertainty or a failing gate may exceed it, and the
  rule must say so.
- `SKILL.md` duplicates a short subset of the writing guide. Leaving a stale summary there would keep
  teaching the conflict even after `writing-vi.md` is corrected.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Read the opening priority and the rule about rewriting | Factual fidelity and confidence outrank clarity, formality, and elegance; unsupported details are forbidden | P0 |
| H2 | Happy | Compare every existing ❌ → ✅ pair | Both sides describe the same actor, facts, scope, cause, consequence, and confidence, except where the good side explicitly exposes missing evidence | P0 |
| H3 | Happy | Ask a yes/no question before the relevant check has run | The guide calls for a direct "Chưa xác nhận được" answer, not an invented yes/no and not a preamble | P0 |
| H4 | Happy | Read the format guidance in both files | Both choose prose, bullets, and tables by relationship and reading task; neither uses "three items" alone as the deciding rule | P0 |
| V1 | Validation | Rewrite "Người dùng có thể mất dữ liệu" for a developer reader | The affected actor remains "người dùng"; it does not become "bạn" | P0 |
| V2 | Validation | Rewrite a vague sentence that contains a real confidence limit such as "đa số" or "tương đối" | The limit is made measurable or kept explicit, not silently upgraded to certainty | P0 |
| V3 | Validation | Rewrite pure padding such as "có thể nói rằng" where removing it changes nothing | The padding is still removed | P1 |
| EC1 | Edge | Add relevant context backed by a cited test result or log | Allowed; the new rule distinguishes evidence-backed context from invented detail | P1 |
| EC2 | Edge | A finding contains confirmed evidence, an inference, and an unknown | Part 7 still labels the three confidence levels separately | P0 |
| EC3 | Edge | An external ticket is derived from a complete investigation dossier | Part 8 may omit facts irrelevant to the reader's decision but may not alter the facts it keeps | P0 |
| EC4 | Edge | Count all ❌ and ✅ markers after editing | Counts stay paired, and the number stated in `SKILL.md` is exact | P1 |
| E1 | Error | A pair's ❌ side states an unverified cause; rewrite it | The ✅ side keeps the cause unverified or names the missing check; it does not assert the cause as fact | P0 |
| E2 | Error | A source sentence names no actor; rewrite for clarity | The rewrite leaves the actor unnamed or marks it unknown; it does not invent one | P0 |
| E3 | Error | A source reports a failure without a count; rewrite it | No number is invented; the rewrite states that the count was not measured | P0 |
| E4 | Error | Apply the "bỏ hết" replacement test to filler that carries a real scope limit | The limit survives as a concrete scope or confidence level; only meaning-free padding is cut | P1 |
| S1 | Security | A finding quotes a code comment containing dramatic wording | Part 7's word ban applies to the agent's own prose, not to quoted evidence; the quote stays verbatim | P0 |
| S2 | Security | An outward-facing ticket is derived from an investigation containing a colleague's mistake | Part 8 still directs that detail out of the ticket; the edit does not make criticism of a named person easier to include | P0 |
| S3 | Security | An investigation record contains customer data quoted from a query result | Editing rules never direct an agent to paraphrase or trim evidence in `investigation.md` | P1 |
| P1 | Performance | Measure the guide's length after the edit | The file stays within roughly 10% of 536 lines, or the increase is justified in the commit message | P1 |
| P2 | Performance | An agent applies the new fidelity rule to a single sentence | The rule is stated as one test an agent can apply without re-reading the whole guide | P1 |
| P3 | Performance | Count the rules an agent must hold while rewriting one sentence | The fidelity rule adds at most one decision step to the existing six-question checklist in Part 6 | P2 |
| H5 | Happy | Read the new rhythm section in `writing-vi.md` | Lead-ins, rhetorical questions, self-commentary, and closing restatement each have a ❌ → ✅ pair whose ✅ side carries the same facts | P0 |
| V4 | Validation | Rewrite a paragraph that opens with "Nói gọn:" and ends by restating its first sentence | Both the lead-in and the restatement are removed; no fact changes | P0 |
| V5 | Validation | Read the length rule in `SKILL.md` | It states a number of sentences, names the exemption for spec.md and investigation.md, and allows exceeding the cap to report an uncertainty or failure | P0 |
| EC5 | Edge | A reply must report a failing gate and the reason | The length rule permits exceeding the cap for that reply | P1 |
