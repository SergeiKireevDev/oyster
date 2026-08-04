import sqlite3 from "sqlite3";

/** Promise-based sqlite3 connection. All native I/O runs on sqlite3's worker pool. */
export function openSqliteDatabase(path, { mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, busyTimeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const native = new sqlite3.Database(path, mode, (error) => {
      if (error) {
        reject(error);
        return;
      }
      native.configure("busyTimeout", busyTimeout);
      resolve(Object.freeze({
        exec(sql) {
          return new Promise((done, fail) => native.exec(sql, (caught) => caught ? fail(caught) : done()));
        },
        get(sql, ...params) {
          return new Promise((done, fail) => native.get(sql, params, (caught, row) => caught ? fail(caught) : done(row)));
        },
        all(sql, ...params) {
          return new Promise((done, fail) => native.all(sql, params, (caught, rows) => caught ? fail(caught) : done(rows)));
        },
        run(sql, ...params) {
          return new Promise((done, fail) => native.run(sql, params, function onRun(caught) {
            if (caught) fail(caught);
            else done({ changes: this.changes, lastInsertRowid: this.lastID });
          }));
        },
        close() {
          return new Promise((done, fail) => native.close((caught) => caught ? fail(caught) : done()));
        },
      }));
    });
  });
}
