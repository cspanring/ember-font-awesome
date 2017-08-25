/* eslint-env node */
'use strict';

var chalk = require('chalk');
var fs = require('fs');
var path = require('path');
var Funnel = require('broccoli-funnel');
var faPath = path.dirname(require.resolve('font-awesome/package.json'));
var AstTransform = require('./lib/ast-transform');
var BroccoliFilter = require('broccoli-filter');
var postcss = require('postcss');
// var BroccoliPlugin = require('broccoli-plugin');
// let readdirRecursive = require('fs-readdir-recursive');

function buildPlugin(addon) {
  return class EmberFontAwesomeAstTransform extends AstTransform {
    constructor(options) {
      super(options);
      this.addon = addon;
    }
  }
}

class PruneUnusedIcons extends BroccoliFilter {
  constructor(inputNodes, options) {
    super(inputNodes, options)
    this.options = options;
    this.targetFiles = ['assets/vendor.css'];
    this.postcss = postcss.plugin('postcss-remove-unused-fa-icons', () => {
      return root => {
        root.walkRules(rule => {
          let matchData = rule.selector.match(/\.fa-(.*):before/);
          if (matchData !== null && !this.options.addon.usedFaIcons.has(matchData[1])) {
            rule.remove();
          }
        });
      };
    });
  }

  processString(str /*, relativePath */) {
    if (this.options.addon.usedFaIcons.has('POSSIBLY_ALL')) {
      return str;
    }
    return this.postcss.process(str).css;
  }

  getDestFilePath(relativePath) {
    if (this.targetFiles.includes(relativePath)) {
      return relativePath;
    }
    return null;
  }
}

module.exports = {
  name: 'ember-font-awesome',

  setupPreprocessorRegistry(type, registry) {
    registry.add('htmlbars-ast-plugin', {
      name: 'font-awesome-static-transform',
      plugin: buildPlugin(this),
      baseDir() {
        return __dirname;
      }
    });
  },

  postprocessTree(type, tree) {
    if (type === 'all') {
      return new PruneUnusedIcons(tree, { addon: this });
    }
    return tree;
  },

  treeForVendor: function() {
    // Get configured fontFormats
    let fontFormats = this.hostBuildOptions.fontFormats || ['eot', 'svg', 'ttf', 'woff', 'woff2', 'otf'];
    let fontFormatsString = fontFormats.join(',');
    // Define fontFormatPattern
    let fontFormatPattern;
    if (fontFormats.length > 1) {
      fontFormatPattern = `*.{${fontFormatsString}}`;
    } else {
      fontFormatPattern = `*.${fontFormatsString}`;
    }
    // Funnel required font types
    return new Funnel(faPath, {
      destDir: 'font-awesome',
      include: ['css/*', `fonts/${fontFormatPattern}`]
    });
  },

  included(app, parentAddon) {
    this.usedFaIcons = new Set();
    // Quick fix for add-on nesting
    // https://github.com/aexmachina/ember-cli-sass/blob/v5.3.0/index.js#L73-L75
    // see: https://github.com/ember-cli/ember-cli/issues/3718
    while (typeof app.import !== 'function' && (app.app || app.parent)) {
      app = app.app || app.parent;
    }

    // if app.import and parentAddon are blank, we're probably being consumed by an in-repo-addon
    // or engine, for which the "bust through" technique above does not work.
    if (typeof app.import !== 'function' && !parentAddon) {
      if (app.registry && app.registry.app) {
        app = app.registry.app;
      }
    }

    if (!parentAddon && typeof app.import !== 'function') {
      throw new Error('ember-font-awesome is being used within another addon or engine and is' +
        ' having trouble registering itself to the parent application.');
    }

    // https://github.com/ember-cli/ember-cli/issues/3718#issuecomment-88122543
    this._super.included.call(this, app);

    // Per the ember-cli documentation
    // http://ember-cli.com/extending/#broccoli-build-options-for-in-repo-addons
    var target = (parentAddon || app);
    target.options = target.options || {}; // Ensures options exists for Scss/Less below
    var options = target.options['ember-font-awesome'] || {};

    this.hostBuildOptions = options;

    var scssPath = path.join(faPath, 'scss');
    var lessPath = path.join(faPath, 'less');
    var cssPath = 'vendor/font-awesome/css';
    var fontsPath = 'vendor/font-awesome/fonts';
    var absoluteFontsPath = path.join(faPath, 'fonts');

    // Ensure the font-awesome path is added to the ember-cli-sass addon options
    // (Taking a cue from the Babel options above)
    if (options.useScss) {
      target.options.sassOptions = target.options.sassOptions || {};
      target.options.sassOptions.includePaths = target.options.sassOptions.includePaths || [];
      if (target.options.sassOptions.includePaths.indexOf(scssPath) === -1) {
        target.options.sassOptions.includePaths.push(scssPath);
      }
    }

    // Ensure the font-awesome path is added to the ember-cli-less addon options
    // (Taking a cue from the Babel options above)
    if (options.useLess) {
      target.options.lessOptions = target.options.lessOptions || {};
      target.options.lessOptions.paths = target.options.lessOptions.paths || [];
      if (target.options.lessOptions.paths.indexOf(lessPath) === -1) {
        target.options.lessOptions.paths.push(lessPath);
      }
    }

    // Early out if no assets should be imported
    if ('includeFontAwesomeAssets' in options && !options.includeFontAwesomeAssets) {
      return;
    }

    // Import the css when Sass and Less are NOT used
    if (!options.useScss && !options.useLess) {
      target.import({
        development: path.join(cssPath, 'font-awesome.css'),
        production: path.join(cssPath, 'font-awesome.min.css')
      });
    }

    // Import all files in the fonts folder when option not defined or enabled
    if (!('includeFontFiles' in options) || options.includeFontFiles) {
      // Get all of the font files
      var fontsToImport = fs.readdirSync(absoluteFontsPath);
      var filesInFonts  = []; // Bucket for filenames already in the fonts folder
      var fontsSkipped  = []; // Bucket for fonts not imported because they already have been

      // Find files already imported into the fonts folder
      var fontsFolderPath = options.fontsOutput ? options.fontsOutput : '/fonts';
      target.otherAssetPaths.forEach(function(asset){
        if (asset.dest && asset.dest.indexOf(fontsFolderPath) !== -1) {
          filesInFonts.push(asset.file);
        }
      });

      // Attempt to import each font, if not already imported
      fontsToImport.forEach(function(fontFilename){
        if (filesInFonts.indexOf(fontFilename) > -1) {
          fontsSkipped.push(fontFilename);
        } else {
          target.import(
            path.join(fontsPath, fontFilename),
            { destDir: fontsFolderPath }
          );
        }
      });

      // Fonts that had already been imported, so we skipped..
      if (fontsSkipped.length) {
        this.ui.writeLine(chalk.red(
          this.name + ': Fonts already imported into the "/fonts" folder [' + fontsSkipped.join(', ') +
          '] by another addon or in your ember-cli-build.js, disable the import ' +
          'from other locations or disable the Font Awesome import by setting ' +
          '`includeFontFiles:false` for the "' + this.name + '" options in your ember-cli-build.js'
        ));
      }
    }
  }
};
