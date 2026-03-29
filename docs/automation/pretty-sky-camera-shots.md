---
summary: "Recipe for a cron automation that snaps a camera photo when the sky looks pretty"
read_when:
  - You want a camera-triggered sky photo automation
  - You need a copy-pasteable cron recipe that combines node camera access with an isolated agent run
  - You want a config-first example for weather/vision-inspired camera automations
title: "Pretty Sky Camera Shots"
---

# Pretty Sky Camera Shots

This recipe shows how to build a camera-triggered automation that checks the sky on a schedule and takes a photo when it looks worth keeping.

It is a good fit for roof cameras, window cameras, patio cameras, and other fixed views where you want OpenClaw to opportunistically capture beautiful skies without manually checking all day.

## What this automation does

On each run, OpenClaw:

1. checks a paired node camera,
2. inspects the current view,
3. decides whether the sky looks visually interesting enough to keep,
4. takes or keeps a higher-value snapshot, and
5. optionally delivers the result back to chat.

The exact definition of "pretty" is intentionally prompt-driven. You can bias it toward sunsets, dramatic clouds, unusual color, storm light, golden hour, or simply "anything that looks worth saving".

## Why cron is the right fit

Use an **isolated cron job** for this pattern:

- it runs on a precise schedule,
- it does not clutter your main session,
- it can use node tools directly during the run,
- it can announce the result only when there is something worth seeing.

See [Cron vs Heartbeat](/automation/cron-vs-heartbeat) if you are deciding between a heartbeat checklist and a scheduled isolated job.

## Requirements

Before you start, make sure you have:

- a paired node with camera access,
- camera permission granted on that device,
- a chat target if you want announce delivery,
- a model that can reason about images.

Helpful references:

- [Nodes overview](/nodes)
- [Camera](/nodes/camera)
- [Cron jobs](/automation/cron-jobs)

## Choose the camera surface

This recipe works best with a **fixed camera view** so the prompt can compare runs mentally and make consistent decisions.

Typical options:

- a macOS/iOS/Android camera pointed at the sky,
- a phone mounted near a window,
- a roofline or patio camera exposed through a paired node workflow.

If multiple cameras exist on the node, first inspect them manually and choose the right facing/device arrangement.

## Recipe 1: Minimal isolated cron job

This is the simplest working version. It runs every 15 minutes and announces only when the run decides a sky photo is worth sharing.

```bash
openclaw cron add \
  --name "Pretty sky camera shot" \
  --every "15m" \
  --session isolated \
  --message "Use the node camera on the paired roof/sky device. Check the current sky view. If the sky looks beautiful, dramatic, unusually colorful, or otherwise worth keeping, take a photo and send it back with a one-line caption. If the sky looks ordinary, do not force output. Keep the response quiet and concise." \
  --announce \
  --channel telegram \
  --to "<chat-id>"
```

### Why this works

- `--every 15m` gives regular checks without being too noisy.
- `--session isolated` keeps this automation out of the main chat history.
- The prompt leaves the aesthetic threshold configurable in plain language.
- `--announce` lets the isolated run deliver the result directly.

## Recipe 2: More selective golden-hour watcher

If you only care about sunrise and sunset style shots, narrow the prompt and schedule.

```bash
openclaw cron add \
  --name "Golden hour sky watcher" \
  --cron "*/10 5-8,17-21 * * *" \
  --tz "America/Chicago" \
  --session isolated \
  --message "Check the fixed sky camera view. Only capture and send a photo if the sky has standout sunset, sunrise, golden-hour, storm-light, or dramatic cloud color. Prefer restraint over spam. If nothing stands out, return no meaningful output." \
  --announce \
  --channel telegram \
  --to "<chat-id>"
```

This reduces unnecessary checks outside the times when the sky is most likely to be interesting.

## Recipe 3: Save first, announce only on strong hits

If you want a stricter workflow, tell the run to save ordinary candidates quietly and announce only stronger ones.

```bash
openclaw cron add \
  --name "Pretty sky archivist" \
  --every "20m" \
  --session isolated \
  --message "Inspect the roof camera sky view. If the sky is clearly pretty, capture a photo and save it to the appropriate local/node-backed photo folder. Only announce to chat when the shot is especially striking. If the scene is average, skip delivery." \
  --announce \
  --channel telegram \
  --to "<chat-id>"
```

For node-backed file organization, pair this with the file surfaces documented under [Nodes overview](/nodes).

## Prompt design tips

The prompt is the policy layer for this automation. Tighten it until the job matches your taste.

Useful criteria to include:

- color intensity,
- cloud drama,
- visible sun rays,
- storm lighting,
- unusually clear gradients,
- skyline silhouette quality,
- low duplication versus recent shots.

Example stricter wording:

```text
Only capture a photo when the sky is noticeably better than an average clear day. Prefer missing a mediocre shot over sending too many. Avoid duplicates that look nearly identical to a recent capture.
```

## Delivery options

For isolated cron jobs, delivery is controlled by the cron job itself.

Common choices:

- `--announce` to send the result directly,
- `--channel <channel>` plus `--to <target>` to pin the destination,
- `--no-deliver` if you only want internal runs.

See [Cron jobs](/automation/cron-jobs) for the underlying delivery model.

## Operational advice

### Start with a soft schedule

Do not begin with every minute. Start with every 15 or 20 minutes, then tighten later.

### Prefer one fixed viewpoint

A stable scene makes it easier for the automation to identify standout conditions and avoid noisy captures.

### Keep the prompt conservative

If you say "take a photo whenever the sky looks pretty," most models will be generous. If you want fewer but better captures, explicitly say so.

### Review run history

Use cron run logs to see whether the job is too permissive or too quiet.

```bash
openclaw cron list
openclaw cron runs --id <job-id>
openclaw cron run <job-id>
```

## Troubleshooting

### The job runs but never captures anything

Likely causes:

- the prompt is too strict,
- the camera is pointed poorly,
- lighting conditions are too flat,
- the node camera permission is missing.

### The job sends too many mediocre shots

Tighten the prompt with language like:

- "prefer restraint over spam"
- "only when clearly better than average"
- "avoid near-duplicates"
- "skip ordinary blue sky"

### The node camera cannot be reached

Check node pairing, permissions, and the camera surface first.

Relevant docs:

- [Nodes overview](/nodes)
- [Camera](/nodes/camera)
- [Troubleshooting](/automation/troubleshooting)

## Verification checklist

Before calling this automation done in production, verify:

- the cron job appears in `openclaw cron list`,
- the node camera works manually,
- a forced run can inspect the scene,
- delivery reaches the expected target when a strong scene is found,
- ordinary scenes do not create noisy spam.

## Rollback

If the automation is too noisy or misconfigured:

```bash
openclaw cron disable <job-id>
openclaw cron rm <job-id>
```

If the problem is only the threshold, edit the prompt instead of deleting the whole job.
