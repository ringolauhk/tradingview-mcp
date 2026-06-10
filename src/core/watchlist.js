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
  const result = await evaluate(`
    (function() {
      var right = document.querySelector('[class*="layout__area--right"]');
      if (!right || right.offsetWidth < 50) return { watchlists: [], source: 'panel_closed' };

      // Method 1: tab-bar style (each tab is a named watchlist)
      var tabs = right.querySelectorAll('[class*="tab"][class*="title"], [class*="listTab"], [class*="watchlistTab"]');
      if (tabs.length > 0) {
        var lists = [];
        for (var i = 0; i < tabs.length; i++) {
          var name = tabs[i].getAttribute('title') || tabs[i].textContent.trim();
          var active = tabs[i].getAttribute('aria-selected') === 'true'
            || tabs[i].classList.toString().indexOf('active') !== -1
            || tabs[i].classList.toString().indexOf('Active') !== -1
            || tabs[i].classList.toString().indexOf('selected') !== -1;
          if (name) lists.push({ name: name, active: active });
        }
        if (lists.length > 0) return { watchlists: lists, source: 'tabs' };
      }

      // Method 2: dropdown-header showing the current list name
      var header = right.querySelector('[class*="listTitle"], [class*="watchlistTitle"], [class*="listName"], [data-name*="watchlist-title"]');
      if (header) {
        var currentName = header.getAttribute('title') || header.textContent.trim();
        if (currentName) return { watchlists: [{ name: currentName, active: true }], source: 'header_only' };
      }

      // Method 3: any button in right panel that looks like a watchlist name picker
      var btns = right.querySelectorAll('button[class*="list"], button[class*="watchlist"]');
      if (btns.length > 0) {
        var btnLists = [];
        for (var j = 0; j < btns.length; j++) {
          var t = btns[j].getAttribute('title') || btns[j].textContent.trim();
          if (t && t.length < 80) btnLists.push({ name: t, active: false });
        }
        if (btnLists.length > 0) return { watchlists: btnLists, source: 'buttons' };
      }

      return { watchlists: [], source: 'not_found' };
    })()
  `);

  return {
    success: true,
    count: result?.watchlists?.length || 0,
    source: result?.source || 'unknown',
    watchlists: result?.watchlists || [],
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

  const nameLower = name.toLowerCase();

  // Method 1: tab-bar style — find tab matching the name and click it
  const tabResult = await evaluate(`
    (function(targetName) {
      var right = document.querySelector('[class*="layout__area--right"]');
      if (!right) return { found: false, reason: 'no_right_panel' };

      var tabs = right.querySelectorAll('[class*="tab"][class*="title"], [class*="listTab"], [class*="watchlistTab"]');
      for (var i = 0; i < tabs.length; i++) {
        var label = (tabs[i].getAttribute('title') || tabs[i].textContent.trim()).trim();
        if (label.toLowerCase() === targetName) {
          tabs[i].click();
          return { found: true, matched_name: label, method: 'tab' };
        }
      }
      return { found: false, reason: 'tab_not_matched', tabs_seen: tabs.length };
    })(${JSON.stringify(nameLower)})
  `);

  if (tabResult?.found) {
    await new Promise(r => setTimeout(r, 600));
    return { success: true, name, matched_name: tabResult.matched_name, method: tabResult.method };
  }

  // Method 2: dropdown — click the header/title button to open the picker
  const dropdownOpened = await evaluate(`
    (function() {
      var right = document.querySelector('[class*="layout__area--right"]');
      if (!right) return { opened: false, reason: 'no_right_panel' };

      var selectors = [
        '[class*="listTitle"]',
        '[class*="watchlistTitle"]',
        '[class*="listName"]',
        '[data-name*="watchlist-title"]',
        '[class*="listSwitcher"] button',
        '[class*="watchlistSwitcher"] button',
      ];
      for (var s = 0; s < selectors.length; s++) {
        var el = right.querySelector(selectors[s]);
        if (el && el.offsetParent !== null) {
          el.click();
          return { opened: true, selector: selectors[s] };
        }
      }
      return { opened: false, reason: 'no_header_found' };
    })()
  `);

  if (!dropdownOpened?.opened) {
    throw new Error(
      `Watchlist "${name}" not found. ` +
      `Could not open watchlist switcher (${dropdownOpened?.reason}). ` +
      `Make sure TradingView is open and the watchlist panel is visible.`
    );
  }

  await new Promise(r => setTimeout(r, 350));

  // Click the list item matching the name in the dropdown
  const itemResult = await evaluate(`
    (function(targetName) {
      // Items may be in a popup/portal or inside the right panel
      var containers = [
        document.querySelector('[class*="watchlistMenu"]'),
        document.querySelector('[class*="listMenu"]'),
        document.querySelector('[class*="dropdownMenu"]'),
        document.querySelector('[class*="popup"]'),
        document.querySelector('[class*="layout__area--right"]'),
        document.body,
      ];
      for (var c = 0; c < containers.length; c++) {
        if (!containers[c]) continue;
        var items = containers[c].querySelectorAll('[class*="item"], [role="option"], [role="menuitem"], li');
        for (var i = 0; i < items.length; i++) {
          var label = (items[i].getAttribute('title') || items[i].textContent.trim()).trim();
          if (label.toLowerCase() === targetName && items[i].offsetParent !== null) {
            items[i].click();
            return { found: true, matched_name: label, method: 'dropdown' };
          }
        }
      }
      return { found: false, reason: 'item_not_in_dropdown' };
    })(${JSON.stringify(nameLower)})
  `);

  // Close dropdown if item not found
  if (!itemResult?.found) {
    await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });
    throw new Error(
      `Watchlist "${name}" not found in the switcher dropdown. ` +
      `Available watchlists can be checked with watchlist_list. ` +
      `Verify the name matches exactly (case-insensitive).`
    );
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
