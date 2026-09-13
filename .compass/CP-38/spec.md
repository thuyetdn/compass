# CP-38: Review gate blames a code change when findings belong to another brief
Loại: bug
Phạm vi: commands/review.mjs, test/review-command.test.mjs
Gốc soi: 910670a

## Mục tiêu

`compass review` collapses two different failures into one message. When the brief on disk is
stale (code or spec changed after review) and when the brief is current but `findings.json`
quotes a different brief id (copied from another task, or left over from an earlier round),
the gate prints the same line: "Code hoặc spec đã đổi sau khi soi". In the second case that
sentence is false — nothing changed — and the reader goes looking for a code change that does
not exist.

After this fix the gate names the actual reason. A stale brief keeps today's message. A current
brief with non-matching findings says the findings do not answer this brief, prints both ids,
and does not rewrite the brief.

## Ràng buộc

- Exit codes do not change: both cases stay `1`, the gate record stays `exitCode: 1`.
- The stale-brief path is untouched: same message, brief regenerated, `briefHash` updated.
- The foreign-findings path must not rewrite `review-brief.md` — it is already current. The gate
  record's `briefHash` therefore equals the hash of the existing brief.
- The message must show the id the findings quoted and the id the current brief carries, so a
  reader can tell "copied from elsewhere" from "typo". A findings file with no `brief` field
  gets its own wording ("không ghi trường brief") rather than a fake id.
- No new dependency, no new file. Zero-dependency stays.
- Test names start with `CP-38-<ID>`. Existing `CP-6-*` review tests must still pass unchanged.

## Rủi ro hồi quy

- `CP-6-S3` asserts `/Code hoặc spec đã đổi/` on the stale path. Splitting the branch must keep
  that path first: if the brief is stale, that message wins even when the findings id also
  mismatches, because a stale brief has to be regenerated before anything else is meaningful.
- `CP-6-EC4` and `CP-6-EC5` depend on the gate record being rewritten with `exitCode: 1` when
  the review reopens. The new branch must still write a record.
- The success path (`briefIsCurrent && answersThisBrief`) must not change; it is what `done`
  reads.
- The hint line tells the user to delete `findings.json` and re-review. On the foreign path the
  brief is not regenerated, so the hint must not say "brief mới" — there is none.

## Test cases

| ID | Lớp | Mô tả | Kỳ vọng | Ưu tiên |
|----|-----|-------|---------|---------|
| H1 | Happy | Brief is current; findings quote an id that is not this brief's | exit 1; output names both ids and says the findings do not answer this brief; output does NOT contain "Code hoặc spec đã đổi" | P0 |
| H2 | Happy | Code changes after findings were filed (the `CP-6-S3` scenario) | exit 1; output still contains "Code hoặc spec đã đổi"; brief is regenerated | P0 |
| V1 | Validation | A second task T-2 with a different spec is reviewed, and its `findings.json` is copied into T-1 | T-1 reports foreign findings, quoting T-2's id and T-1's id | P0 |
| E1 | Error | Brief is current; findings JSON has no `brief` field | exit 1; output says the findings do not record a brief id; no fabricated id is printed | P1 |
| EC1 | Edge | Brief is stale AND findings quote a foreign id | stale-brief message wins; brief regenerated | P1 |
| EC2 | Edge | Foreign findings on a current brief | `review-brief.md` content is byte-identical before and after; gate record `briefHash` equals hash of that file | P0 |
| EC3 | Edge | Foreign findings, then user deletes `findings.json` and re-runs | gate returns to the "chưa ai soi" state with exit 1, no stale message | P1 |
