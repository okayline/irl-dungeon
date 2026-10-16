Vendored code: not ours, not edited.

h3-js.es.js        Uber's h3-js (H3 geospatial index), the ES-module browser build, downloaded from
                   https://cdn.jsdelivr.net/npm/h3-js@4/dist/browser/h3-js.es.js on 2026-10-15 (HST). The file does not
                   state its own version; it is the h3-js 4.x build current on that date.
h3-js-LICENSE.txt  Its license: Apache License 2.0. Keep this file with the library.

SHA-256 (to see whether a copy has been changed):
  2932c9fbe968533f03ce98e971bf208ec071a4a628a9ca0695af3432798615da  h3-js.es.js
  c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4  h3-js-LICENSE.txt

It makes no network requests (its memory initializer is embedded, so its one XMLHttpRequest is never reached; the page's
traffic was checked in a browser). To update it: download the new file, replace it, update this note, run `npm test`.
