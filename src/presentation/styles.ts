/**
 * @file styles
 * @description The application stylesheet, in the order the window loads it.
 *
 * Responsibilities:
 * - Hold the one list of stylesheets the application loads
 *
 * Constraints:
 * - The order is the contract. A rule that comes later wins over an earlier
 *   one of the same specificity, so which rule paints an element is decided
 *   by the order of these imports. The window entry point loads them through
 *   this module, and so does the test that reads what the browser paints — a
 *   stylesheet assembled twice can disagree with itself, and then the test
 *   proves a cascade the application never loads.
 */

import './app/theme/base.css'
import './app/theme/themes.css'
import './app/components/components.css'
import './app/shell.css'
