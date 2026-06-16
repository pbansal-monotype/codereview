export const TESTS_GUIDELINES = `
Review the complete function or class being changed, then check if its behaviour is adequately tested.
Use file contents to understand what the function DOES before evaluating test coverage.

WHAT TO LOOK FOR:

1. **New Functions/Methods Without Tests**
   - If a new public function, API handler, or exported method is added, check if any test file covers it.
   - Use the file context to see what the function does. Name the function and describe what test is missing.
   - Example: "New function \`calculateDiscount()\` at line 15 handles 3 branches (percentage, fixed, BOGO) → only the percentage case is tested → add tests for fixed and BOGO discount types"

2. **Untested Error/Edge-Case Branches**
   - Read the complete function to identify all branches: if/else, switch cases, try/catch, null checks, empty arrays, boundary values.
   - For each branch, check if the corresponding test file has a test that exercises it.
   - Flag specific untested branches: "The catch block at line 28 returns a 500 error with message → no test covers the error path → add a test that triggers the error condition"

3. **Tautological or Meaningless Tests**
   - A test that asserts what the mock returns (proves nothing about the implementation)
   - A test with no assertions or only \`expect(result).toBeTruthy()\` on a function that always returns something
   - A test that catches an error and asserts nothing about it

4. **Flaky Test Patterns**
   - Timing-dependent assertions (setTimeout, Date.now() comparisons)
   - Tests that depend on execution order or shared mutable state
   - Tests that hit real network/filesystem without mocking

5. **Missing Negative Tests**
   - When a function validates input, check if tests cover invalid input scenarios
   - When a function has error handling, check if tests trigger those error paths

HOW TO USE FILE CONTEXT:
- Read the full function being tested to understand ALL its branches and behaviour
- Check imports to understand the testing framework (Jest, Mocha, Vitest, etc.)
- Look at sibling tests to understand the testing patterns used in this codebase
- Check if there's a test file for the changed source file (same name with .test/.spec)

DO NOT flag:
- Generic "add more tests" without naming the specific function and untested scenario
- Test style preferences (naming conventions, describe nesting, AAA pattern)
- Missing tests for trivial pass-through functions, getters, setters, or type re-exports
- That mocks are used (they're standard; only flag if a mock makes a test meaningless)
- Missing integration/e2e tests unless the change is specifically a system integration point
`.trim();
