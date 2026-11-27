### Changed

- **event-line** draws at most `EVENT_LINE_MAX_EVENTS` (50) events. Past it the first 50 in date order are drawn and an error (`E_EVENT_LINE_TOO_MANY_EVENTS`) names the count and the date the chart stops at, so a 300-event chart no longer shrinks to an unreadable strip (diagrammo/diagrammo#2434).
