'use strict';
(() => {
  const required = ['800 148px Manrope', '700 23px "DM Sans"', '600 29px "DM Sans"',
    '500 27px "DM Sans"', '400 19px "DM Sans"'];

  async function load(fonts, text) {
    await Promise.all(required.map(async font => {
      // check() alone also succeeds when a stylesheet failed and no matching
      // @font-face exists. load() must return actual, successfully loaded faces.
      const faces = await fonts.load(font, text);
      if (!faces.length || faces.some(face => face.status !== 'loaded')) {
        throw new Error(`Required card font did not load: ${font}`);
      }
    }));
  }

  const api = {load};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.DRONE_OG_FONTS = api;
})();
