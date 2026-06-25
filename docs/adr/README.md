# Architecture Decision Records — dgmo

Each ADR records one load-bearing decision and **why**, so a future architecture review (or a future you) doesn't re-litigate it. The `/improve-codebase-architecture` skill reads this directory before proposing deepening candidates and will only contradict an ADR when the friction is real enough to warrant reopening it.

This is the ratchet: when a candidate is rejected for a reason a future explorer would need to avoid re-suggesting it, write it down here.

Format: `NNNN-short-title.md`, numbered sequentially. Status is one of `Accepted`, `Superseded by NNNN`, `Proposed`.

These seed records (0001–0005) were reverse-engineered from the existing codebase and the project's decision history at bootstrap; they describe the architecture as it stands, not new proposals.
