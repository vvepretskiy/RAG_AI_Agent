const logger = {
  init() {
    const isDev = process.env.NODE_ENV === 'development';

    if (!isDev) {
        const { Console } = require('console');
        Console.prototype.log = function () { };
        console.log = function () { };
    } else {
        const originalLog = console.log.bind(console);
        console.log = (...args) => originalLog('[DEV]', ...args);
    }
  },
};

export default logger;