# Seattle Traffic Watch — feature build sequence

1. **What Changed?** — perceptual change detection and the Unusual Now collection.
2. **Traffic Time Machine** — historical snapshots, scrubber, and before/after.
3. **Seattle Pulse** — citywide interestingness ranking with transportation context.
4. **Corridor View** — synchronized route camera walls and congestion propagation.
5. **Surprise Me / Seattle Channel** — ambient, ranked discovery mode.

Each feature should land as a measurable vertical slice without sacrificing the snapshot-first performance budget. Shared historical storage introduced for Time Machine should also become the durable citywide memory layer for What Changed? and Seattle Pulse.
