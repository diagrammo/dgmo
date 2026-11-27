### Fixed

- **gantt**: a gantt draws at most `GANTT_MAX_TASKS` (100) tasks, counted across all groups. Past it the first 100 tasks in source order are drawn at normal row height, with their groups; dependency arrows onto tasks not drawn are left out; and one error (`E_GANTT_TOO_MANY_TASKS`) on the first task not drawn names the count. Before, 300 tasks scaled the chart down to hairlines (diagrammo/diagrammo#2442).
