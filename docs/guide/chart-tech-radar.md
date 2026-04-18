# Technology Radar

```dgmo
tech-radar Product Strategy Radar — Q2 2026

rings
  Invest
  Experiment
  Watch
  Sunset

Growth Channels | quadrant: top-right
  Content Marketing | ring: Invest, trend: stable
    Our highest-ROI channel. Blog traffic drives **42% of signups**.
    - SEO-first strategy producing 3 articles/week
    - Conversion rate: *4.2%* from blog visitor to trial
  Community-Led Growth | ring: Experiment, trend: up
    Building user community on Discord. Early signals are strong —
    **800 members** in first 2 months, 15% converting to paid.
  Influencer Partnerships | ring: Watch, trend: new
    Exploring micro-influencer partnerships in the productivity space.

Revenue Models | quadrant: top-left
  Usage-Based Pricing | ring: Invest, trend: up
    Migrating from flat-rate to **usage-based** pricing. Early cohorts
    show *23% higher LTV* compared to flat-rate customers.
  Annual Contracts | ring: Invest, trend: stable
  Freemium Tier | ring: Experiment, trend: new
    Testing a limited free tier to reduce acquisition cost.

Market Segments | quadrant: bottom-left
  Mid-Market SaaS | ring: Invest, trend: stable
    Core segment — **78% of ARR**. Strong product-market fit.
  Enterprise | ring: Experiment, trend: up
    Piloting with 3 Fortune 500 accounts. Key requirements:
    - SSO and SCIM provisioning
    - *SOC 2 Type II* certification (in progress)
    - Dedicated support SLAs
  SMB Self-Serve | ring: Sunset, trend: down
    Deprioritizing due to **high churn** (12% monthly) and low LTV.

Customer Experience | quadrant: bottom-right
  In-App Onboarding | ring: Invest, trend: stable
    Interactive product tours reduced time-to-value from *14 days* to **3 days**.
  AI-Powered Support | ring: Experiment, trend: new
    Testing AI chatbot for tier-1 support. Resolving **35%** of
    tickets without human intervention in pilot.
  NPS Surveys | ring: Watch, trend: stable
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
tech-radar Market Expansion Radar

rings
  Scale
  Pilot
  Evaluate
  Phase Out

Direct Sales | quadrant: top-right
  Enterprise Outbound | ring: Scale, trend: stable
  Partner Channel | ring: Pilot, trend: up
    Testing reseller partnerships in APAC region.
  Cold Outreach | ring: Phase Out, trend: down

Digital Channels | quadrant: top-left
  SEO & Content | ring: Scale, trend: stable
  Paid Social | ring: Pilot, trend: new
  Email Campaigns | ring: Scale, trend: stable

Product Strategy | quadrant: bottom-left
  Self-Serve Onboarding | ring: Scale, trend: up
  AI Features | ring: Evaluate, trend: new
    Exploring AI-assisted workflows for power users.
  White-Label | ring: Evaluate, trend: stable

Customer Success | quadrant: bottom-right
  Health Scoring | ring: Scale, trend: stable
  Automated Renewals | ring: Pilot, trend: up
  Community Forum | ring: Evaluate, trend: new
```
