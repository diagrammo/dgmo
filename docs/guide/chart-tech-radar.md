# Technology Radar

```dgmo
tech-radar Pirate Operations Radar — Q2 1718

rings
  Full Sail
  Trial Run
  Spyglass
  Davy Jones

Tactics | quadrant: top-right
  Ambush at Dawn | ring: Full Sail, trend: stable
    Our most reliable boarding tactic. **90% success rate** when
    approaching from the east with the sun behind us.
    - Crew morale peaks at dawn — grog hasn't worn off yet
    - Reduced cannon fire needed: *3 volleys* vs 8 at midday
  Boarding Parties | ring: Full Sail, trend: stable
  Decoy Flags | ring: Trial Run, trend: up
    Flying false colours until within cannon range. Early results
    are promising — merchant ships drop anchor **40% more often**.
  Smoke Screens | ring: Trial Run, trend: new
  Kraken Diplomacy | ring: Spyglass, trend: new
    Exploring alliances with *sea monsters*. Negotiations ongoing.

Vessels | quadrant: top-left
  Brigantine | ring: Full Sail, trend: stable
    Our workhorse. Fast, manoeuvrable, carries **18 cannons**.
    - Crew capacity: 100 pirates
    - Top speed: *11 knots* in fair wind
  Sloop | ring: Full Sail, trend: up
  War Galleon | ring: Trial Run, trend: up
    Captured from the Spanish fleet. Massive firepower but
    **slow to turn** — best for convoy raids, not chases.
  Longboat | ring: Davy Jones, trend: down

Plunder Targets | quadrant: bottom-left
  Merchant Convoys | ring: Full Sail, trend: stable
    Core revenue stream — **78% of total plunder**. East India
    Company ships running the spice route remain most lucrative.
  Port Raids | ring: Trial Run, trend: up
  Rival Pirates | ring: Trial Run, trend: new
  Royal Treasury Ships | ring: Spyglass, trend: new
    High risk, astronomical reward. Requires:
    - Inside information from *corrupt harbourmasters*
    - At least **3 allied ships** for the blockade
    - A really good escape plan
  Whaling Ships | ring: Spyglass, trend: stable
  Fishing Villages | ring: Davy Jones, trend: down
    Terrible ROI and **bad for reputation**. The parrot union
    filed a formal complaint.

Crew Welfare | quadrant: bottom-right
  Grog Rations | ring: Full Sail, trend: stable
    Non-negotiable. Cutting grog rations caused the *Great Mutiny of 1716*.
  Sea Shanty Program | ring: Trial Run, trend: new
    Hired a shanty master. Crew productivity up **25%** during
    long voyages. Signature tune: *"Yo Ho Ho and a Bottle of Rum"*.
  Dental Plan | ring: Spyglass, trend: up
    Exploring options. Most crew down to **4 teeth** on average.
    Parley with a Port Royal dentist scheduled for Q3.
```

## Overview

Technology radars visualize how an organization adopts and evaluates technologies, practices, or strategies. Inspired by the [ThoughtWorks Technology Radar](https://www.thoughtworks.com/radar), each radar arranges items ("blips") into concentric rings indicating adoption stage, grouped by quadrant categories.

Click any quadrant label to drill down into a detail view with expanded blip descriptions. Click the "Blip Legend" toggle to show or hide the numbered reference listing below the radar.

## Syntax

```
tech-radar Title

rings
  Ring1
  Ring2

Quadrant Name | quadrant: position
  Blip Name | ring: RingName, trend: value
    Description text (markdown supported)
```

## Settings

| Key | Description | Default |
| --- | ----------- | ------- |
| `chart` | Must be `tech-radar` | — |
| `title` | Radar title | None |

## Rings

Rings represent adoption stages, ordered from innermost (highest commitment) to outermost (lowest). Declare them in a `rings` block:

```
rings
  Adopt
  Trial
  Assess
  Hold
```

You can use any ring names — the classic Adopt/Trial/Assess/Hold is common but not required.

### Ring Aliases

Rings support aliases for shorter blip references:

```
rings
  Adopt alias a
  Trial alias t
  Assess alias x
  Hold alias h

Quadrant | quadrant: top-right
  Item Name | ring: a, trend: up
```

## Quadrants

Exactly 4 quadrants are required. Each needs a unique position:

```
Techniques | quadrant: top-right
Tools | quadrant: top-left
Platforms | quadrant: bottom-left
Languages | quadrant: bottom-right
```

**Positions:** `top-left`, `top-right`, `bottom-left`, `bottom-right`

### Custom Colors

Override the default quadrant color with `color`:

```
Tools | quadrant: top-left, color: purple
```

Default colors: top-left=blue, top-right=green, bottom-left=red, bottom-right=orange.

## Blips

Blips are items placed on the radar. Each is indented under its quadrant and requires a `ring` reference:

```
  Kubernetes | ring: Adopt
  Micro Frontends | ring: Trial, trend: up
```

Ring matching is case-insensitive — `ring: adopt` and `ring: Adopt` both work.

## Trends

The optional `trend` metadata controls the visual indicator on each blip:

| Trend | Indicator | Meaning |
| ----- | --------- | ------- |
| `new` | Double circle | Newly added to the radar |
| `up` | Inward crescent | Moving toward center (higher adoption) |
| `down` | Outward crescent | Moving away from center (declining) |
| `stable` | Plain circle | No change since last assessment |

Omitting `trend` renders a plain circle (same as `stable`).

## Descriptions

Further-indented lines below a blip become its description. Descriptions support inline markdown:

```
  Rust | ring: Assess, trend: new
    Evaluating for **performance-critical** services.
    Key benefits: *zero-cost abstractions* and `no GC pauses`.
    - 12x throughput improvement in image pipeline
    - See [evaluation doc](https://wiki.example.com/rust)
```

Descriptions appear in the quadrant detail view and on hover/click in the main radar view.

## Complete Example

```dgmo
tech-radar Fleet Readiness Radar

rings
  Battle Ready
  Sea Trials
  Scouting
  Scuttle

Navigation | quadrant: top-right
  Star Charts | ring: Battle Ready, trend: stable
  Compass Calibration | ring: Sea Trials, trend: up
    New lodestone from Madagascar shows **30% better accuracy**.
  Sextant | ring: Battle Ready, trend: stable
  Treasure Maps | ring: Scouting, trend: new
  Celestial Tables | ring: Scouting, trend: new

Armaments | quadrant: top-left
  Cannon Broadside | ring: Battle Ready, trend: stable
  Greek Fire | ring: Sea Trials, trend: new
  Chain Shot | ring: Sea Trials, trend: up
  Catapult | ring: Scuttle, trend: down

Provisions | quadrant: bottom-left
  Salted Pork | ring: Battle Ready, trend: stable
  Citrus Rations | ring: Sea Trials, trend: up
    Reduced scurvy cases by **80%** in trial crews.
  Rum Distillation | ring: Scouting, trend: new
  Hardtack | ring: Scuttle, trend: down
  Barnacle Soup | ring: Scuttle, trend: down

Morale | quadrant: bottom-right
  Shore Leave | ring: Battle Ready, trend: stable
  Sea Shanties | ring: Battle Ready, trend: up
  Parrot Companions | ring: Scouting, trend: new
  Plank Walking | ring: Scuttle, trend: down
```
