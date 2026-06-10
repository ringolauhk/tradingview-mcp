import { register } from '../router.js';
import * as core from '../../core/watchlist.js';

register('watchlist', {
  description: 'Watchlist tools (get, list, switch, add)',
  subcommands: new Map([
    ['get', {
      description: 'Get symbols from the currently visible watchlist',
      handler: () => core.get(),
    }],
    ['list', {
      description: 'List all watchlist names and which is active',
      handler: () => core.list(),
    }],
    ['switch', {
      description: 'Switch to a named watchlist (case-insensitive)',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Name required. Usage: tv watchlist switch "Jlaw list"');
        return core.switchTo({ name: positionals[0] });
      },
    }],
    ['add', {
      description: 'Add a symbol to the watchlist',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Symbol required. Usage: tv watchlist add AAPL');
        return core.add({ symbol: positionals[0] });
      },
    }],
  ]),
});
