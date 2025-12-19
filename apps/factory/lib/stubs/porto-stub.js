// Complete stub for porto to fix wagmi connectors import errors
// The porto connector has broken dependencies that we stub out

const noop = () => ({});
const noopAsync = async () => ({});

// Export empty implementations of all porto exports
module.exports = {
  // Internal exports
  z: {
    object: () => ({ parse: noop, safeParse: noop }),
    string: () => ({ parse: () => '', safeParse: noop }),
    number: () => ({ parse: () => 0, safeParse: noop }),
    boolean: () => ({ parse: () => false, safeParse: noop }),
    array: () => ({ parse: () => [], safeParse: noop }),
    optional: (x) => x,
    union: () => ({ parse: noop, safeParse: noop }),
    literal: () => ({ parse: noop, safeParse: noop }),
    enum: () => ({ parse: noop, safeParse: noop }),
  },
  Call: {},
  TrustedHosts: [],
  
  // Main porto exports
  Porto: {
    create: noop,
    createClient: noop,
  },
  createPorto: noop,
  
  // Mode exports
  Mode: {
    dialog: noop,
    iframe: noop,
    redirect: noop,
  },
  
  // Account exports
  Account: {
    create: noop,
    from: noop,
  },
  
  // Default export
  default: {
    Porto: { create: noop },
    createPorto: noop,
  },
};
