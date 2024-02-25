/**
 * Express router paths go here.
 */


export default {
  Base: '/api',
  Users: {
    Base: '/users',
    Get: '/all',
    Add: '/add',
    Update: '/update',
    Delete: '/delete/:id',
  },
  Deploy: {
    Base: '/deploy',
    Start: '/start',
    Status: '/status/:id',
  },
  Ping: {
    Base: '/agent',
    PingAgent: '/ping',
  },
} as const;
