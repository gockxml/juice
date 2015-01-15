
/**
 * juice
 * Copyright(c) 2011 LearnBoost <dev@learnboost.com>
 * MIT Licensed
 */

module.exports = juice;

/**
 * Module dependencies.
 */

var utils = require('./utils')
  , Selector = require('./selector')
  , Property = require('./property')
  , packageJson = require('../package')
  , fs = require('fs')
  , Batch = require('batch')
  , url = require('url')
  , superagent = require('superagent')
  , path = require('path')
  , assert = require('assert')
  , os = require('os')
  , styleSelector = new Selector('<style attribute>', [1, 0, 0, 0])
  , importantSelector = new Selector('<!important>', [2, 0, 0, 0])

/**
 * Package version
 */

juice.version = packageJson.version;

/**
 * Export Selector.
 */

juice.Selector = Selector;

/**
 * Export Property.
 */

juice.Property = Property;

/**
 * Export utils.
 */

juice.utils = require('./utils');


juice.ignoredPseudos = ['hover', 'active', 'focus', 'visited', 'link'];
juice.widthElements = ['TABLE', 'TD', 'IMG'];

juice.juiceDocument = juiceDocument;
juice.juiceContent = juiceContent;
juice.juiceFile = juiceFile;
juice.inlineDocument = inlineDocument;
juice.inlineContent = inlineContent;

function inlineDocument(document, css, options) {

  var rules = utils.parseCSS(css)
    , editedElements = [];

  rules.forEach(handleRule);
  editedElements.forEach(inlineElementStyles);

  if (options && options.applyWidthAttributes) {
    editedElements.forEach(setWidthAttrs);
  }

  function handleRule(rule) {
    var sel = rule[0]
      , style = rule[1]
      , selector = new Selector(sel)
      , parsedSelector = selector.parsed()
      , pseudoElementType = getPseudoElementType(parsedSelector);

    // skip rule if the selector has any pseudos which are ignored
    for (var i = 0; i < parsedSelector.length; ++i) {
      var subSel = parsedSelector[i];
      if (subSel.pseudos) {
        for (var j = 0; j < subSel.pseudos.length; ++j) {
          var subSelPseudo = subSel.pseudos[j];
          if (juice.ignoredPseudos.indexOf(subSelPseudo.name) >= 0) return;
        }
      }
    }

    if (pseudoElementType) {
      var last = parsedSelector[parsedSelector.length - 1];
      var pseudos = last.pseudos;
      last.pseudos = filterElementPseudos(last.pseudos),
      sel = parsedSelector.toString();
      last.pseudos = pseudos;
    }

    var els;
    try {
      els = document.querySelectorAll(sel);
    } catch (err) {
      // skip invalid selector
      return;
    }
    utils.toArray(els).forEach(function (el) {
      if (pseudoElementType) {
        var pseudoElPropName = "pseudo" + pseudoElementType;
        var pseudoEl = el[pseudoElPropName];
        if ( ! pseudoEl) {
          pseudoEl = el[pseudoElPropName] = document.createElement("span");
          pseudoEl.pseudoElementType = pseudoElementType;
          pseudoEl.pseudoElementParent = el;
          el["pseudo" + pseudoElementType] = pseudoEl;
          editedElements.push(pseudoEl);
        }
        el = pseudoEl;
      }

      if (!el.styleProps) {
        el.styleProps = {}

        // if the element has inline styles, fake selector with topmost specificity
        if (el.getAttribute('style')) {
          var cssText = '* { ' + el.getAttribute('style') + ' } '
          addProps(utils.parseCSS(cssText)[0][1], styleSelector);
        }

        // store reference to an element we need to compile style="" attr for
        editedElements.push(el);
      }

      // go through the properties
      function addProps (style, selector) {
        for (var i = 0, l = style.length; i < l; i++) {
          var name = style[i]
            , value = style[name]
            , sel = style._importants[name] ? importantSelector : selector
            , prop = new Property(name, value, sel)
            , existing = el.styleProps[name];

          if (existing) {
            var winner = existing.compare(prop)
              , loser = prop === winner ? existing : prop

            if (winner === prop) el.styleProps[name] = prop;
          } else {
            el.styleProps[name] = prop;
          }
        }
      }

      addProps(style, selector);
    });
  }

  function inlineElementStyles(el) {
    // Get array of style properties
    var props = Object.keys(el.styleProps).map(function(key) {
      return el.styleProps[key];
    });

    // sort properties by their originating selector's specifity so that props
    // like "padding" and "padding-bottom" are resolved as expected.
    props.sort(function(a, b) {
      return a.selector.specificity().join("").localeCompare(
        b.selector.specificity().join(""));
    });

    // Generate string
    var imp = options && options.importantEverything ? " !important" : "";
    var string = props
      // Remove "content" props
      .filter(function(prop) {
        return prop.prop !== "content";
      })
      .map(function(prop) {
        return prop.prop + ": " + prop.value.replace(/["]/g, "'") + imp + ";";
      })
      .join(" ");

    // Set style attribute
    if (string) {
      el.setAttribute('style', string);
    }

    // Insert pseudo elements
    if (el.pseudoElementType && el.styleProps.content) {
      el.innerHTML = parseContent(el.styleProps.content.value);
      var parent = el.pseudoElementParent;
      if (el.pseudoElementType === "before") {
        parent.insertBefore(el, parent.firstChild);
      }
      else {
        parent.appendChild(el);
      }
    }
  }
  
  function setWidthAttrs(el) {
    if (juice.widthElements.indexOf(el.nodeName) > -1) {
      for (var i in el.styleProps) {
        if (el.styleProps[i].prop === 'width' && el.styleProps[i].value.match(/px/)) {
          var pxWidth = el.styleProps[i].value.replace('px', '');
          el.setAttribute('width', pxWidth);
          return;
        }
      }
    }
  }
}

function parseContent(content) {
  if (content === "none" || content === "normal") {
    return "";
  }

  // Naive parsing, assume well-formed value
  content = content.slice(1, content.length - 1);
  // Naive unescape, assume no unicode char codes
  content = content.replace(/\\/g, "");
  return content;
}

// Return "before" or "after" if the given selector is a pseudo element (e.g.,
// a::after).
function getPseudoElementType(selector) {
  if (selector.length === 0) {
    return;
  }

  var pseudos = selector[selector.length - 1].pseudos;
  if ( ! pseudos) {
    return;
  }

  for (var i = 0; i < pseudos.length; i++) {
    if (isPseudoElementName(pseudos[i])) {
      return pseudos[i].name;
    }
  }
}

function isPseudoElementName(pseudo) {
  return pseudo.name === "before" || pseudo.name === "after";
}

function filterElementPseudos(pseudos) {
  return pseudos.filter(function(pseudo) {
    return ! isPseudoElementName(pseudo);
  });
}

function juiceDocument(document, options, callback) {
  assert.ok(options.url, "options.url is required");
  options = getDefaultOptions(options);
  extractCssFromDocument(document, options, function(err, css) {
    if (err) {
      return callback(err);
    }

    css += "\n" + options.extraCss;
    inlineDocumentWithCb(document, css, options, callback);
  });
}

function juiceContent(html, options, callback) {
  assert.ok(options.url, "options.url is required");
  options = getDefaultOptions(options);
  // hack to force jsdom to see this argument as html content, not a url
  // or a filename. https://github.com/tmpvar/jsdom/issues/554
  html += "\n";
  var document = utils.jsdom(html);
  juiceDocument(document, options, function(err) {
    if (err) {
      // free the associated memory
      // with lazily created parentWindow
      try {
       document.parentWindow.close();
      } catch (cleanupErr) {}
      callback(err);
    } else {
      var inner = utils.docToString(document);
      // free the associated memory
      // with lazily created parentWindow
      try {
        document.parentWindow.close();
      } catch (cleanupErr) {}
      callback(null, inner);
    }
  });
}

function getDefaultOptions(options) {
  return utils.extend({
    extraCss: "",
    applyStyleTags: true,
    removeStyleTags: true,
    applyLinkTags: true,
    removeLinkTags: true,
    preserveMediaQueries: false,
    applyWidthAttributes: false,
  }, options);
}

function juiceFile(filePath, options, callback) {
  // set default options
  fs.readFile(filePath, 'utf8', function(err, content) {
    if (err) return callback(err);
    options = getDefaultOptions(options); // so we can mutate options without guilt
    var slashes = os.platform() === 'win32' ? '\\\\' : '//';
    options.url = options.url || ("file:" + slashes + path.resolve(process.cwd(), filePath));
    juiceContent(content, options, callback);
  });
}

function inlineContent(html, css, options) {
  var document = utils.jsdom(html);
  inlineDocument(document, css, options);
  var inner = utils.docToString(document);
  // free the associated memory
  // with lazily created parentWindow
  try {
    document.parentWindow.close();
  } catch (cleanupErr) {}
  return inner;
}

/**
 * Inlines the CSS specified by `css` into the `html`
 *
 * @param {String} html
 * @param {String} css
 * @api public
 */

function juice (arg1, arg2, arg3) {
  // legacy behavior
  if (typeof arg2 === 'string') return inlineContent(arg1, arg2);
  var options = arg3 ? arg2 : {};
  var callback = arg3 ? arg3 : arg2;
  juiceFile(arg1, options, callback);
}

function inlineDocumentWithCb(document, css, options, callback) {
  try {
    inlineDocument(document, css, options);
    callback();
  } catch (err) {
    callback(err);
  }
}

function getStylesData(document, options, callback) {
  var results = [];
  var stylesList = document.getElementsByTagName("style");
  var i, styleDataList, styleData, styleElement;
  for (i = 0; i < stylesList.length; ++i) {
    styleElement = stylesList[i];
    styleDataList = styleElement.childNodes;
    if (styleDataList.length !== 1) {
      callback(new Error("empty style element"));
      return;
    }
    styleData = styleDataList[0].data;
    if ( options.applyStyleTags ) results.push( styleData );
    if ( options.removeStyleTags )
    {
    	if ( options.preserveMediaQueries )
    	{
    		var mediaQueries = utils.getMediaQueryText( styleElement.childNodes[0].nodeValue );
    		styleElement.childNodes[0].nodeValue = mediaQueries;
    	}
    	else
    	{
    		styleElement.parentNode.removeChild( styleElement );
    	}
    }
  }
  callback(null, results);
}

function getHrefContent(destHref, sourceHref, callback) {
  if (url.parse(sourceHref).protocol === 'file:' && destHref[0] === '/') {
    destHref = destHref.slice(1);
  }
  var resolvedUrl = url.resolve(sourceHref, destHref);
  var parsedUrl = url.parse(resolvedUrl);
  if (parsedUrl.protocol === 'file:') {
    fs.readFile(decodeURIComponent(parsedUrl.pathname), 'utf8', callback);
  } else {
    getRemoteContent(resolvedUrl, callback);
  }
}

function getRemoteContent(remoteUrl, callback) {
  superagent.get(remoteUrl).buffer().end(function(err, resp) {
    if (err) {
      callback(err);
    } else if (resp.ok) {
      callback(null, resp.text);
    } else {
      callback(new Error("GET " + remoteUrl + " " + resp.status));
    }
  });
}

function getStylesheetList(document, options) {
  var results = [];
  var linkList = document.getElementsByTagName("link");
  var link, i, j, attr, attrs;
  for (i = 0; i < linkList.length; ++i) {
    link = linkList[i];
    attrs = {};
    for (j = 0; j < link.attributes.length; ++j) {
      attr = link.attributes[j];
      attrs[attr.name.toLowerCase()] = attr.value;
    }
    if (attrs.rel && attrs.rel.toLowerCase() === 'stylesheet') {
      if (options.applyLinkTags) results.push(attrs.href);
      if (options.removeLinkTags) link.parentNode.removeChild(link);
    }
  }
  return results;
}

function extractCssFromDocument(document, options, callback) {
  var batch = new Batch();
  batch.push(function(callback) { getStylesData(document, options, callback); });
  getStylesheetList(document, options).forEach(function(stylesheetHref) {
    batch.push(function(callback) {
      getHrefContent(stylesheetHref, options.url, callback);
    });
  });
  batch.end(function(err, results) {
    if (err) return callback(err);
    var stylesData = results.shift();
    results.forEach(function(content) {
      stylesData.push(content);
    });
    var css = stylesData.join("\n");
    callback(null, css);
  });
}

