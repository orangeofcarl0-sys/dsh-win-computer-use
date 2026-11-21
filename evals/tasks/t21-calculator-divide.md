# t21 / calculator-divide

- **stages: S1**
- **tier: smoke**
- **isolation: clean**
- **ac2: full**
- **app: calculator**
- **hotspot: uia-element**
- **requires: calculator**
- **variants: 3**
- tools: screen_observe / computer_click / computer_type / computer_key
- sandbox: 无文件产物
- oracle: 从 setup 记录的 owned Calculator HWND 读显示值 == variant expected；用户已有计算器时 setup ENV
- 2026-11-21: 第二条 Calculator 任务，覆盖除法与不同结果，避免单题应用覆盖；variant 1-3 使用不同被除数/除数与期望值。

## Prompt

<<<PROMPT
计算器已经打开。请计算 {{expression}} 的结果，完成后保持计算器窗口打开（不要关闭）。
PROMPT>>>

## Notes

- 与 t04 共用 `Start-Calculator`/`Get-CalculatorWindow`；状态文件独立为 `test-calculator-2.json`，避免和 t04 串用。
- Oracle 只读 setup 记录的 HWND，不绑定用户已有的计算器。
- 变体值来自 `evals/variants/t21.json`；setup 写入 `expected`，oracle 不硬编码结果，simulate 用同一 expression 驱动。
