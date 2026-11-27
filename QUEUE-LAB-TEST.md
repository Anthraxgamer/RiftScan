# V0.7.4 Queue Lab — phone acceptance test

The regular V0.7.3.8 scanner remains the production fallback. Queue Lab has a separate IndexedDB collection and does not import, alter or export to the old collection. The home link is the only legacy-page change.

## First test: capture and processing independently
1. Stop the regular scanner; open queue-lab.html in the same browser.
2. Start camera, choose the known sharp rear camera (Camera 0 on the test phone), reopen at 1080p. Align one card.
3. Tap Capture card and wait for IMAGE CAPTURED. Only then replace it.
4. Tap Next card / rearm and Capture card. Use two physical copies of the same ID, then another ID. The first job may still be processing.
5. Stop the camera. Leave the page open until the queue drains.
6. Verify there is exactly one record per accepted capture, and inspect unresolved images using View / review. IDs that do not meet the two-read threshold stay in review. All finishes are uncertain until manually verified.
7. Refresh while jobs are queued and confirm they recover. Do not clear site data.

## Second test: optional automatic presence gate
With a stationary phone and empty surface, calibrate the empty background, then enable Automatic capture. Present a card, wait for the stored receipt, completely remove it and leave a visible empty gap before presenting another. Test empty table, one held card, ten identical copies, and a textured background. If the phone moves, turn off automatic mode and recalibrate. A manual capture/next-card path remains available.

## Boundaries
- 50 unfinished/ID-review jobs, 1000 total records. Storage failure pauses admission; an uncommitted image is held in memory and is not acknowledged as stored.
- Store at most two ranked original ID crops, thumbnail and up to four small artwork images; at most four OCR calls/job. One worker, 30-second per-job OCR timeout after worker initialization.
- No real foil classifier, four-point calibration, robust card tracking, production collection integration, automatic camera ranking, or database validation yet. The automatic gate is a simple background/texture heuristic, not a trained character detector.
- Web Locks and IndexedDB required; browser may suspend processing when hidden/locked and may evict site data. JSON export includes metadata and recognition results, not image blobs.
- Existing scanner collection is not modified. Lab captures are not automatically imported into it. No promises of capture speed until measured on device.
