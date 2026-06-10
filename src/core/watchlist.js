/**
 * Core watchlist logic.
 * Uses TradingView's internal widget API with DOM fallback.
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';

export async function get() {
  // Try internal API first — reads from the active watchlist widget
  const symbols = await evaluate(`
    (function() {
      // Method 1: Try the watchlist widget's internal data
      try {
        var rightArea = document.querySelector('[class*="layout__area--right"]');
        if (!rightArea || rightArea.offsetWidth < 50) return { symbols: [], source: 'panel_closed' };
      } catch(e) {}

      // Method 2: Read data-symbol-full attributes from watchlist rows
      var results = [];
      var seen = {};
      var container = document.querySelector('[class*="layout__area--right"]');
      if (!container) return { symbols: [], source: 'no_container' };

      // Find all elements with symbol data attributes
      var symbolEls = container.querySelectorAll('[data-symbol-full]');
      for (var i = 0; i < symbolEls.length; i++) {
        var sym = symbolEls[i].getAttribute('data-symbol-full');
        if (!sym || seen[sym]) continue;
        seen[sym] = true;

        // Find the row and extract price data
        var row = symbolEls[i].closest('[class*="row"]') || symbolEls[i].parentElement;
        var cells = row ? row.querySelectorAll('[class*="cell"], [class*="column"]') : [];
        var nums = [];
        for (var j = 0; j < cells.length; j++) {
          var t = cells[j].textContent.trim();
          if (t && /^[\\-+]?[\\d,]+\\.?\\d*%?$/.test(t.replace(/[\\s,]/g, ''))) nums.push(t);
        }
        results.push({ symbol: sym, last: nums[0] || null, change: nums[1] || null, change_percent: nums[2] || null });
      }

      if (results.length > 0) return { symbols: results, source: 'data_attributes' };

      // Method 3: Scan for ticker-like text in the right panel
      var items = container.querySelectorAll('[class*="symbolName"], [class*="tickerName"], [class*="symbol-"]');
      for (var k = 0; k < items.length; k++) {
        var text = items[k].textContent.trim();
        if (text && /^[A-Z][A-Z0-9.:!]{0,20}$/.test(text) && !seen[text]) {
          seen[text] = true;
          results.push({ symbol: text, last: null, change: null, change_percent: null });
        }
      }

      return { symbols: results, source: results.length > 0 ? 'text_scan' : 'empty' };
    })()
  `);

  return {
    success: true,
    count: symbols?.symbols?.length || 0,
    source: symbols?.source || 'unknown',
    symbols: symbols?.symbols || [],
  };
}

export async function list() {
  const c = await getClient();

  // Ensure watchlist panel is open
  const panelState = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="base-watchlist-widget-button"]')
        || document.querySelector('[aria-label*="Watchlist"]');
      if (!btn) return { error: 'Watchlist button not found' };
      var isActive = btn.getAttribute('aria-pressed') === 'true'
        || btn.classList.toString().indexOf('Active') !== -1
        || btn.classList.toString().indexOf('active') !== -1;
      if (!isActive) { btn.click(); return { opened: true }; }
      return { opened: false };
    })()
  `);

  if (panelState?.error) throw new Error(panelState.error);
  if (panelState?.opened) await new Promise(r => setTimeout(r, 500));

  // Open picker only if it is not already open.
  // The watchlists-button gets an "isOpened-" CSS class while the picker is visible.
  const pickerState = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="watchlists-button"]');
      if (!btn) return { error: 'watchlists-button not found', currentName: null };
      var isOpen = btn.className.indexOf('isOpened-') !== -1;
      if (!isOpen) btn.click();
      return { wasOpen: isOpen, opened: !isOpen, currentName: btn.textContent.trim() };
    })()
  `);

  if (pickerState?.error) {
    return { success: true, count: 0, source: 'picker_button_not_found', watchlists: [] };
  }

  if (pickerState?.opened) await new Promise(r => setTimeout(r, 400));

  // Read all watchlist names.
  // Watchlist name rows have no grandparent element (row.parentElement.parentElement
  // is absent or unclassed). Menu actions (Share list, Rename, etc.) are nested one
  // level deeper — their row's grandparent has a class containing "newView-".
  // Active item: row's immediate parent div has "selected-" in its class.
  const pickerItems = await evaluate(`
    (function() {
      var cells = document.querySelectorAll('[role="gridcell"]');
      var results = [];
      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        var name = cell.textContent.trim();
        if (!name || name.length > 80) continue;
        var row = cell.closest('[role="row"]');
        if (!row) continue;
        // Skip menu actions — their row's grandparent contains "newView-"
        var grandparent = row.parentElement ? row.parentElement.parentElement : null;
        if (grandparent && grandparent.className && grandparent.className.indexOf('newView-') !== -1) continue;
        var active = row.parentElement
          ? row.parentElement.className.indexOf('selected-') !== -1
          : false;
        results.push({ name: name, active: active });
      }
      return results;
    })()
  `);

  // Close the picker
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });

  if (pickerItems && pickerItems.length > 0) {
    return {
      success: true,
      count: pickerItems.length,
      source: 'picker',
      watchlists: pickerItems,
    };
  }

  // Fallback: return only the current name from the header button
  const currentName = pickerState?.currentName;
  return {
    success: true,
    count: currentName ? 1 : 0,
    source: 'header_only',
    watchlists: currentName ? [{ name: currentName, active: true }] : [],
  };
}

export async function switchTo({ name }) {
  const c = await getClient();

  // Ensure watchlist panel is open
  const panelState = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="base-watchlist-widget-button"]')
        || document.querySelector('[aria-label*="Watchlist"]');
      if (!btn) return { error: 'Watchlist button not found' };
      var isActive = btn.getAttribute('aria-pressed') === 'true'
        || btn.classList.toString().indexOf('Active') !== -1
        || btn.classList.toString().indexOf('active') !== -1;
      if (!isActive) { btn.click(); return { opened: true }; }
      return { opened: false };
    })()
  `);

  if (panelState?.error) throw new Error(panelState.error);
  if (panelState?.opened) await new Promise(r => setTimeout(r, 500));

  // Open picker only if not already open
  const pickerOpened = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="watchlists-button"]');
      if (!btn) return { opened: false, reason: 'watchlists-button not found' };
      var isOpen = btn.className.indexOf('isOpened-') !== -1;
      if (!isOpen) btn.click();
      return { opened: true, wasAlreadyOpen: isOpen };
    })()
  `);

  if (!pickerOpened?.opened) {
    throw new Error(
      `Cannot open watchlist picker: ${pickerOpened?.reason}. ` +
      `Make sure TradingView is open and the watchlist panel is visible.`
    );
  }

  if (!pickerOpened.wasAlreadyOpen) await new Promise(r => setTimeout(r, 400));

  const nameLower = name.toLowerCase();

  // Find picker item matching name and click its row.
  // Skip menu actions — their row's grandparent contains "newView-".
  const itemResult = await evaluate(`
    (function(targetName) {
      var cells = document.querySelectorAll('[role="gridcell"]');
      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        var text = cell.textContent.trim();
        if (text.toLowerCase() !== targetName) continue;
        var row = cell.closest('[role="row"]');
        if (!row) continue;
        var grandparent = row.parentElement ? row.parentElement.parentElement : null;
        if (grandparent && grandparent.className && grandparent.className.indexOf('newView-') !== -1) continue;
        if (row.offsetParent !== null) {
          row.click();
          return { found: true, matched_name: text, method: 'picker_gridcell' };
        }
      }
      // Build available list (watchlist names only, no menu actions)
      var available = [];
      var all = document.querySelectorAll('[role="gridcell"]');
      for (var j = 0; j < all.length; j++) {
        var t = all[j].textContent.trim();
        if (!t || t.length >= 80) continue;
        var r = all[j].closest('[role="row"]');
        if (!r) continue;
        var gp = r.parentElement ? r.parentElement.parentElement : null;
        if (gp && gp.className && gp.className.indexOf('newView-') !== -1) continue;
        available.push(t);
      }
      return { found: false, available: available };
    })(${JSON.stringify(nameLower)})
  `);

  if (!itemResult?.found) {
    await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });
    const avail = itemResult?.available?.length
      ? `Available: ${itemResult.available.join(', ')}`
      : 'Run watchlist_list to see available names.';
    throw new Error(`Watchlist "${name}" not found. ${avail}`);
  }

  await new Promise(r => setTimeout(r, 600));
  return { success: true, name, matched_name: itemResult.matched_name, method: itemResult.method };
}

export async function add({ symbol }) {
  // Use keyboard shortcut to open symbol search in watchlist, type symbol, press Enter
  const c = await getClient();

  // First ensure watchlist panel is open
  const panelState = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="base-watchlist-widget-button"]')
        || document.querySelector('[aria-label*="Watchlist"]');
      if (!btn) return { error: 'Watchlist button not found' };
      var isActive = btn.getAttribute('aria-pressed') === 'true'
        || btn.classList.toString().indexOf('Active') !== -1
        || btn.classList.toString().indexOf('active') !== -1;
      if (!isActive) { btn.click(); return { opened: true }; }
      return { opened: false };
    })()
  `);

  if (panelState?.error) throw new Error(panelState.error);
  if (panelState?.opened) await new Promise(r => setTimeout(r, 500));

  // Click the "Add symbol" button (various selectors)
  const addClicked = await evaluate(`
    (function() {
      var selectors = [
        '[data-name="add-symbol-button"]',
        '[aria-label="Add symbol"]',
        '[aria-label*="Add symbol"]',
        'button[class*="addSymbol"]',
      ];
      for (var s = 0; s < selectors.length; s++) {
        var btn = document.querySelector(selectors[s]);
        if (btn && btn.offsetParent !== null) { btn.click(); return { found: true, selector: selectors[s] }; }
      }
      // Fallback: find + button in right panel
      var container = document.querySelector('[class*="layout__area--right"]');
      if (container) {
        var buttons = container.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
          var ariaLabel = buttons[i].getAttribute('aria-label') || '';
          if (/add.*symbol/i.test(ariaLabel) || buttons[i].textContent.trim() === '+') {
            buttons[i].click();
            return { found: true, method: 'fallback' };
          }
        }
      }
      return { found: false };
    })()
  `);

  if (!addClicked?.found) throw new Error('Add symbol button not found in watchlist panel');
  await new Promise(r => setTimeout(r, 300));

  // Type the symbol into the search input
  await c.Input.insertText({ text: symbol });
  await new Promise(r => setTimeout(r, 500));

  // Press Enter to select the first result
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  await new Promise(r => setTimeout(r, 300));

  // Press Escape to close search
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });

  return { success: true, symbol, action: 'added' };
}
