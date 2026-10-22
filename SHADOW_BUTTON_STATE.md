# v3.5 Shadow button state

The v3.4 code already prevented duplicate Shadow preparation:
`if (!lesson || shadowState === "preparing") return;`

v3.5 makes the running state clearer:
- disabled button while analysis is running;
- `aria-disabled` and `aria-busy`;
- visible spinner;
- stronger disabled styling;
- duplicate clicks remain blocked in logic.
