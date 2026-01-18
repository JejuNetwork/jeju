var path = require('path');

function Mime() {
  this.types = Object.create(null);
  this.extensions = Object.create(null);
}

Mime.prototype.define = function (map) {
  for (var type in map) {
    var exts = map[type];
    for (var i = 0; i < exts.length; i++) {
      this.types[exts[i]] = type;
    }
    if (!this.extensions[type]) {
      this.extensions[type] = exts[0];
    }
  }
};

Mime.prototype.lookup = function(pathOrExt, fallback) {
  var ext = String(pathOrExt).replace(/^.*[\.\/\\]/, '').toLowerCase();
  return this.types[ext] || fallback || this.default_type;
};

Mime.prototype.extension = function(mimeType) {
  var type = mimeType.match(/^\s*([^;\s]*)(?:;|\s|$)/)[1].toLowerCase();
  return this.extensions[type];
};

// Inline types - prevents require issues with bun
var types = {
  "text/html": ["html", "htm", "shtml"],
  "text/css": ["css"],
  "text/xml": ["xml"],
  "image/gif": ["gif"],
  "image/jpeg": ["jpeg", "jpg", "jpe"],
  "application/javascript": ["js", "mjs"],
  "application/atom+xml": ["atom"],
  "application/rss+xml": ["rss"],
  "text/mathml": ["mml"],
  "text/plain": ["txt", "text", "conf", "def", "list", "log", "in", "ini"],
  "text/vnd.sun.j2me.app-descriptor": ["jad"],
  "text/vnd.wap.wml": ["wml"],
  "text/x-component": ["htc"],
  "image/png": ["png"],
  "image/svg+xml": ["svg", "svgz"],
  "image/tiff": ["tiff", "tif"],
  "image/vnd.wap.wbmp": ["wbmp"],
  "image/webp": ["webp"],
  "image/x-icon": ["ico"],
  "image/x-jng": ["jng"],
  "image/bmp": ["bmp"],
  "font/woff": ["woff"],
  "font/woff2": ["woff2"],
  "application/java-archive": ["jar", "war", "ear"],
  "application/json": ["json", "map"],
  "application/mac-binhex40": ["hqx"],
  "application/msword": ["doc"],
  "application/pdf": ["pdf"],
  "application/postscript": ["ps", "eps", "ai"],
  "application/rtf": ["rtf"],
  "application/vnd.apple.mpegurl": ["m3u8"],
  "application/vnd.google-earth.kml+xml": ["kml"],
  "application/vnd.google-earth.kmz": ["kmz"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.ms-fontobject": ["eot"],
  "application/vnd.ms-powerpoint": ["ppt"],
  "application/vnd.oasis.opendocument.graphics": ["odg"],
  "application/vnd.oasis.opendocument.presentation": ["odp"],
  "application/vnd.oasis.opendocument.spreadsheet": ["ods"],
  "application/vnd.oasis.opendocument.text": ["odt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.wap.wmlc": ["wmlc"],
  "application/wasm": ["wasm"],
  "application/x-7z-compressed": ["7z"],
  "application/x-cocoa": ["cco"],
  "application/x-java-archive-diff": ["jardiff"],
  "application/x-java-jnlp-file": ["jnlp"],
  "application/x-makeself": ["run"],
  "application/x-perl": ["pl", "pm"],
  "application/x-pilot": ["prc", "pdb"],
  "application/x-rar-compressed": ["rar"],
  "application/x-redhat-package-manager": ["rpm"],
  "application/x-sea": ["sea"],
  "application/x-shockwave-flash": ["swf"],
  "application/x-stuffit": ["sit"],
  "application/x-tcl": ["tcl", "tk"],
  "application/x-x509-ca-cert": ["der", "pem", "crt"],
  "application/x-xpinstall": ["xpi"],
  "application/xhtml+xml": ["xhtml"],
  "application/xspf+xml": ["xspf"],
  "application/zip": ["zip"],
  "application/octet-stream": ["bin", "exe", "dll", "deb", "dmg", "iso", "img", "msi", "msp", "msm"],
  "audio/midi": ["mid", "midi", "kar"],
  "audio/mpeg": ["mp3"],
  "audio/ogg": ["ogg"],
  "audio/x-m4a": ["m4a"],
  "audio/x-realaudio": ["ra"],
  "video/3gpp": ["3gpp", "3gp"],
  "video/mp2t": ["ts"],
  "video/mp4": ["mp4"],
  "video/mpeg": ["mpeg", "mpg"],
  "video/quicktime": ["mov"],
  "video/webm": ["webm"],
  "video/x-flv": ["flv"],
  "video/x-m4v": ["m4v"],
  "video/x-mng": ["mng"],
  "video/x-ms-asf": ["asx", "asf"],
  "video/x-ms-wmv": ["wmv"],
  "video/x-msvideo": ["avi"]
};

// Create and configure default instance
var mime = new Mime();

// Define all types
for (var type in types) {
  var exts = types[type];
  var map = {};
  map[type] = exts;
  mime.define(map);
}

// Default type
mime.default_type = mime.lookup('bin');

// Additional API
mime.Mime = Mime;

mime.charsets = {
  lookup: function(mimeType, fallback) {
    return (/^text\/|^application\/(javascript|json)/).test(mimeType) ? 'UTF-8' : fallback;
  }
};

// Also support v2+ API for compatibility
mime.getType = mime.lookup.bind(mime);
mime.getExtension = mime.extension.bind(mime);

module.exports = mime;
