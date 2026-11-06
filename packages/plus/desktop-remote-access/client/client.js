window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-desktop-plus-remote-access",
  factory: (require) => {
var module = { exports: {} };
var exports = module.exports;

"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/client.source.jsx
var client_source_exports = {};
__export(client_source_exports, {
  apply: () => apply2,
  inject: () => inject
});
module.exports = __toCommonJS(client_source_exports);
var import_react6 = __toESM(require("react"), 1);

// ../../../node_modules/.pnpm/qrcode-generator@2.0.4/node_modules/qrcode-generator/dist/qrcode.mjs
var qrcode = function(typeNumber, errorCorrectionLevel) {
  const PAD0 = 236;
  const PAD1 = 17;
  let _typeNumber = typeNumber;
  const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
  let _modules = null;
  let _moduleCount = 0;
  let _dataCache = null;
  const _dataList = [];
  const _this = {};
  const makeImpl = function(test, maskPattern) {
    _moduleCount = _typeNumber * 4 + 17;
    _modules = (function(moduleCount) {
      const modules = new Array(moduleCount);
      for (let row = 0; row < moduleCount; row += 1) {
        modules[row] = new Array(moduleCount);
        for (let col = 0; col < moduleCount; col += 1) {
          modules[row][col] = null;
        }
      }
      return modules;
    })(_moduleCount);
    setupPositionProbePattern(0, 0);
    setupPositionProbePattern(_moduleCount - 7, 0);
    setupPositionProbePattern(0, _moduleCount - 7);
    setupPositionAdjustPattern();
    setupTimingPattern();
    setupTypeInfo(test, maskPattern);
    if (_typeNumber >= 7) {
      setupTypeNumber(test);
    }
    if (_dataCache == null) {
      _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
    }
    mapData(_dataCache, maskPattern);
  };
  const setupPositionProbePattern = function(row, col) {
    for (let r = -1; r <= 7; r += 1) {
      if (row + r <= -1 || _moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c += 1) {
        if (col + c <= -1 || _moduleCount <= col + c) continue;
        if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
          _modules[row + r][col + c] = true;
        } else {
          _modules[row + r][col + c] = false;
        }
      }
    }
  };
  const getBestMaskPattern = function() {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i += 1) {
      makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(_this);
      if (i == 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  };
  const setupTimingPattern = function() {
    for (let r = 8; r < _moduleCount - 8; r += 1) {
      if (_modules[r][6] != null) {
        continue;
      }
      _modules[r][6] = r % 2 == 0;
    }
    for (let c = 8; c < _moduleCount - 8; c += 1) {
      if (_modules[6][c] != null) {
        continue;
      }
      _modules[6][c] = c % 2 == 0;
    }
  };
  const setupPositionAdjustPattern = function() {
    const pos = QRUtil.getPatternPosition(_typeNumber);
    for (let i = 0; i < pos.length; i += 1) {
      for (let j = 0; j < pos.length; j += 1) {
        const row = pos[i];
        const col = pos[j];
        if (_modules[row][col] != null) {
          continue;
        }
        for (let r = -2; r <= 2; r += 1) {
          for (let c = -2; c <= 2; c += 1) {
            if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) {
              _modules[row + r][col + c] = true;
            } else {
              _modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  };
  const setupTypeNumber = function(test) {
    const bits = QRUtil.getBCHTypeNumber(_typeNumber);
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  };
  const setupTypeInfo = function(test, maskPattern) {
    const data = _errorCorrectionLevel << 3 | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 6) {
        _modules[i][8] = mod;
      } else if (i < 8) {
        _modules[i + 1][8] = mod;
      } else {
        _modules[_moduleCount - 15 + i][8] = mod;
      }
    }
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 8) {
        _modules[8][_moduleCount - i - 1] = mod;
      } else if (i < 9) {
        _modules[8][15 - i - 1 + 1] = mod;
      } else {
        _modules[8][15 - i - 1] = mod;
      }
    }
    _modules[_moduleCount - 8][8] = !test;
  };
  const mapData = function(data, maskPattern) {
    let inc = -1;
    let row = _moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    const maskFunc = QRUtil.getMaskFunction(maskPattern);
    for (let col = _moduleCount - 1; col > 0; col -= 2) {
      if (col == 6) col -= 1;
      while (true) {
        for (let c = 0; c < 2; c += 1) {
          if (_modules[row][col - c] == null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = (data[byteIndex] >>> bitIndex & 1) == 1;
            }
            const mask = maskFunc(row, col - c);
            if (mask) {
              dark = !dark;
            }
            _modules[row][col - c] = dark;
            bitIndex -= 1;
            if (bitIndex == -1) {
              byteIndex += 1;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || _moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  };
  const createBytes = function(buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r += 1) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i += 1) {
        dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
      }
      offset += dcCount;
      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i += 1) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
      }
    }
    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalCodeCount += rsBlocks[i].totalCount;
    }
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < dcdata[r].length) {
          data[index] = dcdata[r][i];
          index += 1;
        }
      }
    }
    for (let i = 0; i < maxEcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < ecdata[r].length) {
          data[index] = ecdata[r][i];
          index += 1;
        }
      }
    }
    return data;
  };
  const createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
    const buffer = qrBitBuffer();
    for (let i = 0; i < dataList.length; i += 1) {
      const data = dataList[i];
      buffer.put(data.getMode(), 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
      data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalDataCount += rsBlocks[i].dataCount;
    }
    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
    }
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }
    while (buffer.getLengthInBits() % 8 != 0) {
      buffer.putBit(false);
    }
    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD1, 8);
    }
    return createBytes(buffer, rsBlocks);
  };
  _this.addData = function(data, mode) {
    mode = mode || "Byte";
    let newData = null;
    switch (mode) {
      case "Numeric":
        newData = qrNumber(data);
        break;
      case "Alphanumeric":
        newData = qrAlphaNum(data);
        break;
      case "Byte":
        newData = qr8BitByte(data);
        break;
      case "Kanji":
        newData = qrKanji(data);
        break;
      default:
        throw "mode:" + mode;
    }
    _dataList.push(newData);
    _dataCache = null;
  };
  _this.isDark = function(row, col) {
    if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
      throw row + "," + col;
    }
    return _modules[row][col];
  };
  _this.getModuleCount = function() {
    return _moduleCount;
  };
  _this.make = function() {
    if (_typeNumber < 1) {
      let typeNumber2 = 1;
      for (; typeNumber2 < 40; typeNumber2++) {
        const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, _errorCorrectionLevel);
        const buffer = qrBitBuffer();
        for (let i = 0; i < _dataList.length; i++) {
          const data = _dataList[i];
          buffer.put(data.getMode(), 4);
          buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
          data.write(buffer);
        }
        let totalDataCount = 0;
        for (let i = 0; i < rsBlocks.length; i++) {
          totalDataCount += rsBlocks[i].dataCount;
        }
        if (buffer.getLengthInBits() <= totalDataCount * 8) {
          break;
        }
      }
      _typeNumber = typeNumber2;
    }
    makeImpl(false, getBestMaskPattern());
  };
  _this.createTableTag = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    let qrHtml = "";
    qrHtml += '<table style="';
    qrHtml += " border-width: 0px; border-style: none;";
    qrHtml += " border-collapse: collapse;";
    qrHtml += " padding: 0px; margin: " + margin + "px;";
    qrHtml += '">';
    qrHtml += "<tbody>";
    for (let r = 0; r < _this.getModuleCount(); r += 1) {
      qrHtml += "<tr>";
      for (let c = 0; c < _this.getModuleCount(); c += 1) {
        qrHtml += '<td style="';
        qrHtml += " border-width: 0px; border-style: none;";
        qrHtml += " border-collapse: collapse;";
        qrHtml += " padding: 0px; margin: 0px;";
        qrHtml += " width: " + cellSize + "px;";
        qrHtml += " height: " + cellSize + "px;";
        qrHtml += " background-color: ";
        qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
        qrHtml += ";";
        qrHtml += '"/>';
      }
      qrHtml += "</tr>";
    }
    qrHtml += "</tbody>";
    qrHtml += "</table>";
    return qrHtml;
  };
  _this.createSvgTag = function(cellSize, margin, alt, title) {
    let opts = {};
    if (typeof arguments[0] == "object") {
      opts = arguments[0];
      cellSize = opts.cellSize;
      margin = opts.margin;
      alt = opts.alt;
      title = opts.title;
    }
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    alt = typeof alt === "string" ? { text: alt } : alt || {};
    alt.text = alt.text || null;
    alt.id = alt.text ? alt.id || "qrcode-description" : null;
    title = typeof title === "string" ? { text: title } : title || {};
    title.text = title.text || null;
    title.id = title.text ? title.id || "qrcode-title" : null;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let c, mc, r, mr, qrSvg = "", rect;
    rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
    qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
    qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "";
    qrSvg += ' viewBox="0 0 ' + size + " " + size + '" ';
    qrSvg += ' preserveAspectRatio="xMinYMin meet"';
    qrSvg += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "";
    qrSvg += ">";
    qrSvg += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "";
    qrSvg += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "";
    qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
    qrSvg += '<path d="';
    for (r = 0; r < _this.getModuleCount(); r += 1) {
      mr = r * cellSize + margin;
      for (c = 0; c < _this.getModuleCount(); c += 1) {
        if (_this.isDark(r, c)) {
          mc = c * cellSize + margin;
          qrSvg += "M" + mc + "," + mr + rect;
        }
      }
    }
    qrSvg += '" stroke="transparent" fill="black"/>';
    qrSvg += "</svg>";
    return qrSvg;
  };
  _this.createDataURL = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    return createDataURL(size, size, function(x, y) {
      if (min <= x && x < max && min <= y && y < max) {
        const c = Math.floor((x - min) / cellSize);
        const r = Math.floor((y - min) / cellSize);
        return _this.isDark(r, c) ? 0 : 1;
      } else {
        return 1;
      }
    });
  };
  _this.createImgTag = function(cellSize, margin, alt) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let img = "";
    img += "<img";
    img += ' src="';
    img += _this.createDataURL(cellSize, margin);
    img += '"';
    img += ' width="';
    img += size;
    img += '"';
    img += ' height="';
    img += size;
    img += '"';
    if (alt) {
      img += ' alt="';
      img += escapeXml(alt);
      img += '"';
    }
    img += "/>";
    return img;
  };
  const escapeXml = function(s) {
    let escaped = "";
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charAt(i);
      switch (c) {
        case "<":
          escaped += "&lt;";
          break;
        case ">":
          escaped += "&gt;";
          break;
        case "&":
          escaped += "&amp;";
          break;
        case '"':
          escaped += "&quot;";
          break;
        default:
          escaped += c;
          break;
      }
    }
    return escaped;
  };
  const _createHalfASCII = function(margin) {
    const cellSize = 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r1, r2, p;
    const blocks = {
      "\u2588\u2588": "\u2588",
      "\u2588 ": "\u2580",
      " \u2588": "\u2584",
      "  ": " "
    };
    const blocksLastLineNoMargin = {
      "\u2588\u2588": "\u2580",
      "\u2588 ": "\u2580",
      " \u2588": " ",
      "  ": " "
    };
    let ascii = "";
    for (y = 0; y < size; y += 2) {
      r1 = Math.floor((y - min) / cellSize);
      r2 = Math.floor((y + 1 - min) / cellSize);
      for (x = 0; x < size; x += 1) {
        p = "\u2588";
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
          p = " ";
        }
        if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
          p += " ";
        } else {
          p += "\u2588";
        }
        ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
      }
      ascii += "\n";
    }
    if (size % 2 && margin > 0) {
      return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("\u2580");
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.createASCII = function(cellSize, margin) {
    cellSize = cellSize || 1;
    if (cellSize < 2) {
      return _createHalfASCII(margin);
    }
    cellSize -= 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r, p;
    const white = Array(cellSize + 1).join("\u2588\u2588");
    const black = Array(cellSize + 1).join("  ");
    let ascii = "";
    let line = "";
    for (y = 0; y < size; y += 1) {
      r = Math.floor((y - min) / cellSize);
      line = "";
      for (x = 0; x < size; x += 1) {
        p = 1;
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
          p = 0;
        }
        line += p ? white : black;
      }
      for (r = 0; r < cellSize; r += 1) {
        ascii += line + "\n";
      }
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.renderTo2dContext = function(context, cellSize) {
    cellSize = cellSize || 2;
    const length = _this.getModuleCount();
    for (let row = 0; row < length; row++) {
      for (let col = 0; col < length; col++) {
        context.fillStyle = _this.isDark(row, col) ? "black" : "white";
        context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  };
  return _this;
};
qrcode.stringToBytes = function(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    bytes.push(c & 255);
  }
  return bytes;
};
qrcode.createStringToBytes = function(unicodeData, numChars) {
  const unicodeMap = (function() {
    const bin = base64DecodeInputStream(unicodeData);
    const read = function() {
      const b = bin.read();
      if (b == -1) throw "eof";
      return b;
    };
    let count = 0;
    const unicodeMap2 = {};
    while (true) {
      const b0 = bin.read();
      if (b0 == -1) break;
      const b1 = read();
      const b2 = read();
      const b3 = read();
      const k = String.fromCharCode(b0 << 8 | b1);
      const v = b2 << 8 | b3;
      unicodeMap2[k] = v;
      count += 1;
    }
    if (count != numChars) {
      throw count + " != " + numChars;
    }
    return unicodeMap2;
  })();
  const unknownChar = "?".charCodeAt(0);
  return function(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
      } else {
        const b = unicodeMap[s.charAt(i)];
        if (typeof b == "number") {
          if ((b & 255) == b) {
            bytes.push(b);
          } else {
            bytes.push(b >>> 8);
            bytes.push(b & 255);
          }
        } else {
          bytes.push(unknownChar);
        }
      }
    }
    return bytes;
  };
};
var QRMode = {
  MODE_NUMBER: 1 << 0,
  MODE_ALPHA_NUM: 1 << 1,
  MODE_8BIT_BYTE: 1 << 2,
  MODE_KANJI: 1 << 3
};
var QRErrorCorrectionLevel = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2
};
var QRMaskPattern = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7
};
var QRUtil = (function() {
  const PATTERN_POSITION_TABLE = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]
  ];
  const G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
  const G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
  const G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
  const _this = {};
  const getBCHDigit = function(data) {
    let digit = 0;
    while (data != 0) {
      digit += 1;
      data >>>= 1;
    }
    return digit;
  };
  _this.getBCHTypeInfo = function(data) {
    let d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
      d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
    }
    return (data << 10 | d) ^ G15_MASK;
  };
  _this.getBCHTypeNumber = function(data) {
    let d = data << 12;
    while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
      d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
    }
    return data << 12 | d;
  };
  _this.getPatternPosition = function(typeNumber) {
    return PATTERN_POSITION_TABLE[typeNumber - 1];
  };
  _this.getMaskFunction = function(maskPattern) {
    switch (maskPattern) {
      case QRMaskPattern.PATTERN000:
        return function(i, j) {
          return (i + j) % 2 == 0;
        };
      case QRMaskPattern.PATTERN001:
        return function(i, j) {
          return i % 2 == 0;
        };
      case QRMaskPattern.PATTERN010:
        return function(i, j) {
          return j % 3 == 0;
        };
      case QRMaskPattern.PATTERN011:
        return function(i, j) {
          return (i + j) % 3 == 0;
        };
      case QRMaskPattern.PATTERN100:
        return function(i, j) {
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
        };
      case QRMaskPattern.PATTERN101:
        return function(i, j) {
          return i * j % 2 + i * j % 3 == 0;
        };
      case QRMaskPattern.PATTERN110:
        return function(i, j) {
          return (i * j % 2 + i * j % 3) % 2 == 0;
        };
      case QRMaskPattern.PATTERN111:
        return function(i, j) {
          return (i * j % 3 + (i + j) % 2) % 2 == 0;
        };
      default:
        throw "bad maskPattern:" + maskPattern;
    }
  };
  _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
    let a = qrPolynomial([1], 0);
    for (let i = 0; i < errorCorrectLength; i += 1) {
      a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
    }
    return a;
  };
  _this.getLengthInBits = function(mode, type) {
    if (1 <= type && type < 10) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 10;
        case QRMode.MODE_ALPHA_NUM:
          return 9;
        case QRMode.MODE_8BIT_BYTE:
          return 8;
        case QRMode.MODE_KANJI:
          return 8;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 27) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 12;
        case QRMode.MODE_ALPHA_NUM:
          return 11;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 10;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 41) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 14;
        case QRMode.MODE_ALPHA_NUM:
          return 13;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 12;
        default:
          throw "mode:" + mode;
      }
    } else {
      throw "type:" + type;
    }
  };
  _this.getLostPoint = function(qrcode2) {
    const moduleCount = qrcode2.getModuleCount();
    let lostPoint = 0;
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        let sameCount = 0;
        const dark = qrcode2.isDark(row, col);
        for (let r = -1; r <= 1; r += 1) {
          if (row + r < 0 || moduleCount <= row + r) {
            continue;
          }
          for (let c = -1; c <= 1; c += 1) {
            if (col + c < 0 || moduleCount <= col + c) {
              continue;
            }
            if (r == 0 && c == 0) {
              continue;
            }
            if (dark == qrcode2.isDark(row + r, col + c)) {
              sameCount += 1;
            }
          }
        }
        if (sameCount > 5) {
          lostPoint += 3 + sameCount - 5;
        }
      }
    }
    ;
    for (let row = 0; row < moduleCount - 1; row += 1) {
      for (let col = 0; col < moduleCount - 1; col += 1) {
        let count = 0;
        if (qrcode2.isDark(row, col)) count += 1;
        if (qrcode2.isDark(row + 1, col)) count += 1;
        if (qrcode2.isDark(row, col + 1)) count += 1;
        if (qrcode2.isDark(row + 1, col + 1)) count += 1;
        if (count == 0 || count == 4) {
          lostPoint += 3;
        }
      }
    }
    for (let row = 0; row < moduleCount; row += 1) {
      for (let col = 0; col < moduleCount - 6; col += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row, col + 1) && qrcode2.isDark(row, col + 2) && qrcode2.isDark(row, col + 3) && qrcode2.isDark(row, col + 4) && !qrcode2.isDark(row, col + 5) && qrcode2.isDark(row, col + 6)) {
          lostPoint += 40;
        }
      }
    }
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount - 6; row += 1) {
        if (qrcode2.isDark(row, col) && !qrcode2.isDark(row + 1, col) && qrcode2.isDark(row + 2, col) && qrcode2.isDark(row + 3, col) && qrcode2.isDark(row + 4, col) && !qrcode2.isDark(row + 5, col) && qrcode2.isDark(row + 6, col)) {
          lostPoint += 40;
        }
      }
    }
    let darkCount = 0;
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row = 0; row < moduleCount; row += 1) {
        if (qrcode2.isDark(row, col)) {
          darkCount += 1;
        }
      }
    }
    const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  };
  return _this;
})();
var QRMath = (function() {
  const EXP_TABLE = new Array(256);
  const LOG_TABLE = new Array(256);
  for (let i = 0; i < 8; i += 1) {
    EXP_TABLE[i] = 1 << i;
  }
  for (let i = 8; i < 256; i += 1) {
    EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i += 1) {
    LOG_TABLE[EXP_TABLE[i]] = i;
  }
  const _this = {};
  _this.glog = function(n) {
    if (n < 1) {
      throw "glog(" + n + ")";
    }
    return LOG_TABLE[n];
  };
  _this.gexp = function(n) {
    while (n < 0) {
      n += 255;
    }
    while (n >= 256) {
      n -= 255;
    }
    return EXP_TABLE[n];
  };
  return _this;
})();
var qrPolynomial = function(num, shift) {
  if (typeof num.length == "undefined") {
    throw num.length + "/" + shift;
  }
  const _num = (function() {
    let offset = 0;
    while (offset < num.length && num[offset] == 0) {
      offset += 1;
    }
    const _num2 = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i += 1) {
      _num2[i] = num[i + offset];
    }
    return _num2;
  })();
  const _this = {};
  _this.getAt = function(index) {
    return _num[index];
  };
  _this.getLength = function() {
    return _num.length;
  };
  _this.multiply = function(e) {
    const num2 = new Array(_this.getLength() + e.getLength() - 1);
    for (let i = 0; i < _this.getLength(); i += 1) {
      for (let j = 0; j < e.getLength(); j += 1) {
        num2[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
      }
    }
    return qrPolynomial(num2, 0);
  };
  _this.mod = function(e) {
    if (_this.getLength() - e.getLength() < 0) {
      return _this;
    }
    const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
    const num2 = new Array(_this.getLength());
    for (let i = 0; i < _this.getLength(); i += 1) {
      num2[i] = _this.getAt(i);
    }
    for (let i = 0; i < e.getLength(); i += 1) {
      num2[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
    }
    return qrPolynomial(num2, 0).mod(e);
  };
  return _this;
};
var QRRSBlock = (function() {
  const RS_BLOCK_TABLE = [
    // L
    // M
    // Q
    // H
    // 1
    [1, 26, 19],
    [1, 26, 16],
    [1, 26, 13],
    [1, 26, 9],
    // 2
    [1, 44, 34],
    [1, 44, 28],
    [1, 44, 22],
    [1, 44, 16],
    // 3
    [1, 70, 55],
    [1, 70, 44],
    [2, 35, 17],
    [2, 35, 13],
    // 4
    [1, 100, 80],
    [2, 50, 32],
    [2, 50, 24],
    [4, 25, 9],
    // 5
    [1, 134, 108],
    [2, 67, 43],
    [2, 33, 15, 2, 34, 16],
    [2, 33, 11, 2, 34, 12],
    // 6
    [2, 86, 68],
    [4, 43, 27],
    [4, 43, 19],
    [4, 43, 15],
    // 7
    [2, 98, 78],
    [4, 49, 31],
    [2, 32, 14, 4, 33, 15],
    [4, 39, 13, 1, 40, 14],
    // 8
    [2, 121, 97],
    [2, 60, 38, 2, 61, 39],
    [4, 40, 18, 2, 41, 19],
    [4, 40, 14, 2, 41, 15],
    // 9
    [2, 146, 116],
    [3, 58, 36, 2, 59, 37],
    [4, 36, 16, 4, 37, 17],
    [4, 36, 12, 4, 37, 13],
    // 10
    [2, 86, 68, 2, 87, 69],
    [4, 69, 43, 1, 70, 44],
    [6, 43, 19, 2, 44, 20],
    [6, 43, 15, 2, 44, 16],
    // 11
    [4, 101, 81],
    [1, 80, 50, 4, 81, 51],
    [4, 50, 22, 4, 51, 23],
    [3, 36, 12, 8, 37, 13],
    // 12
    [2, 116, 92, 2, 117, 93],
    [6, 58, 36, 2, 59, 37],
    [4, 46, 20, 6, 47, 21],
    [7, 42, 14, 4, 43, 15],
    // 13
    [4, 133, 107],
    [8, 59, 37, 1, 60, 38],
    [8, 44, 20, 4, 45, 21],
    [12, 33, 11, 4, 34, 12],
    // 14
    [3, 145, 115, 1, 146, 116],
    [4, 64, 40, 5, 65, 41],
    [11, 36, 16, 5, 37, 17],
    [11, 36, 12, 5, 37, 13],
    // 15
    [5, 109, 87, 1, 110, 88],
    [5, 65, 41, 5, 66, 42],
    [5, 54, 24, 7, 55, 25],
    [11, 36, 12, 7, 37, 13],
    // 16
    [5, 122, 98, 1, 123, 99],
    [7, 73, 45, 3, 74, 46],
    [15, 43, 19, 2, 44, 20],
    [3, 45, 15, 13, 46, 16],
    // 17
    [1, 135, 107, 5, 136, 108],
    [10, 74, 46, 1, 75, 47],
    [1, 50, 22, 15, 51, 23],
    [2, 42, 14, 17, 43, 15],
    // 18
    [5, 150, 120, 1, 151, 121],
    [9, 69, 43, 4, 70, 44],
    [17, 50, 22, 1, 51, 23],
    [2, 42, 14, 19, 43, 15],
    // 19
    [3, 141, 113, 4, 142, 114],
    [3, 70, 44, 11, 71, 45],
    [17, 47, 21, 4, 48, 22],
    [9, 39, 13, 16, 40, 14],
    // 20
    [3, 135, 107, 5, 136, 108],
    [3, 67, 41, 13, 68, 42],
    [15, 54, 24, 5, 55, 25],
    [15, 43, 15, 10, 44, 16],
    // 21
    [4, 144, 116, 4, 145, 117],
    [17, 68, 42],
    [17, 50, 22, 6, 51, 23],
    [19, 46, 16, 6, 47, 17],
    // 22
    [2, 139, 111, 7, 140, 112],
    [17, 74, 46],
    [7, 54, 24, 16, 55, 25],
    [34, 37, 13],
    // 23
    [4, 151, 121, 5, 152, 122],
    [4, 75, 47, 14, 76, 48],
    [11, 54, 24, 14, 55, 25],
    [16, 45, 15, 14, 46, 16],
    // 24
    [6, 147, 117, 4, 148, 118],
    [6, 73, 45, 14, 74, 46],
    [11, 54, 24, 16, 55, 25],
    [30, 46, 16, 2, 47, 17],
    // 25
    [8, 132, 106, 4, 133, 107],
    [8, 75, 47, 13, 76, 48],
    [7, 54, 24, 22, 55, 25],
    [22, 45, 15, 13, 46, 16],
    // 26
    [10, 142, 114, 2, 143, 115],
    [19, 74, 46, 4, 75, 47],
    [28, 50, 22, 6, 51, 23],
    [33, 46, 16, 4, 47, 17],
    // 27
    [8, 152, 122, 4, 153, 123],
    [22, 73, 45, 3, 74, 46],
    [8, 53, 23, 26, 54, 24],
    [12, 45, 15, 28, 46, 16],
    // 28
    [3, 147, 117, 10, 148, 118],
    [3, 73, 45, 23, 74, 46],
    [4, 54, 24, 31, 55, 25],
    [11, 45, 15, 31, 46, 16],
    // 29
    [7, 146, 116, 7, 147, 117],
    [21, 73, 45, 7, 74, 46],
    [1, 53, 23, 37, 54, 24],
    [19, 45, 15, 26, 46, 16],
    // 30
    [5, 145, 115, 10, 146, 116],
    [19, 75, 47, 10, 76, 48],
    [15, 54, 24, 25, 55, 25],
    [23, 45, 15, 25, 46, 16],
    // 31
    [13, 145, 115, 3, 146, 116],
    [2, 74, 46, 29, 75, 47],
    [42, 54, 24, 1, 55, 25],
    [23, 45, 15, 28, 46, 16],
    // 32
    [17, 145, 115],
    [10, 74, 46, 23, 75, 47],
    [10, 54, 24, 35, 55, 25],
    [19, 45, 15, 35, 46, 16],
    // 33
    [17, 145, 115, 1, 146, 116],
    [14, 74, 46, 21, 75, 47],
    [29, 54, 24, 19, 55, 25],
    [11, 45, 15, 46, 46, 16],
    // 34
    [13, 145, 115, 6, 146, 116],
    [14, 74, 46, 23, 75, 47],
    [44, 54, 24, 7, 55, 25],
    [59, 46, 16, 1, 47, 17],
    // 35
    [12, 151, 121, 7, 152, 122],
    [12, 75, 47, 26, 76, 48],
    [39, 54, 24, 14, 55, 25],
    [22, 45, 15, 41, 46, 16],
    // 36
    [6, 151, 121, 14, 152, 122],
    [6, 75, 47, 34, 76, 48],
    [46, 54, 24, 10, 55, 25],
    [2, 45, 15, 64, 46, 16],
    // 37
    [17, 152, 122, 4, 153, 123],
    [29, 74, 46, 14, 75, 47],
    [49, 54, 24, 10, 55, 25],
    [24, 45, 15, 46, 46, 16],
    // 38
    [4, 152, 122, 18, 153, 123],
    [13, 74, 46, 32, 75, 47],
    [48, 54, 24, 14, 55, 25],
    [42, 45, 15, 32, 46, 16],
    // 39
    [20, 147, 117, 4, 148, 118],
    [40, 75, 47, 7, 76, 48],
    [43, 54, 24, 22, 55, 25],
    [10, 45, 15, 67, 46, 16],
    // 40
    [19, 148, 118, 6, 149, 119],
    [18, 75, 47, 31, 76, 48],
    [34, 54, 24, 34, 55, 25],
    [20, 45, 15, 61, 46, 16]
  ];
  const qrRSBlock = function(totalCount, dataCount) {
    const _this2 = {};
    _this2.totalCount = totalCount;
    _this2.dataCount = dataCount;
    return _this2;
  };
  const _this = {};
  const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
    switch (errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default:
        return void 0;
    }
  };
  _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
    const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
    if (typeof rsBlock == "undefined") {
      throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
    }
    const length = rsBlock.length / 3;
    const list = [];
    for (let i = 0; i < length; i += 1) {
      const count = rsBlock[i * 3 + 0];
      const totalCount = rsBlock[i * 3 + 1];
      const dataCount = rsBlock[i * 3 + 2];
      for (let j = 0; j < count; j += 1) {
        list.push(qrRSBlock(totalCount, dataCount));
      }
    }
    return list;
  };
  return _this;
})();
var qrBitBuffer = function() {
  const _buffer = [];
  let _length = 0;
  const _this = {};
  _this.getBuffer = function() {
    return _buffer;
  };
  _this.getAt = function(index) {
    const bufIndex = Math.floor(index / 8);
    return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
  };
  _this.put = function(num, length) {
    for (let i = 0; i < length; i += 1) {
      _this.putBit((num >>> length - i - 1 & 1) == 1);
    }
  };
  _this.getLengthInBits = function() {
    return _length;
  };
  _this.putBit = function(bit) {
    const bufIndex = Math.floor(_length / 8);
    if (_buffer.length <= bufIndex) {
      _buffer.push(0);
    }
    if (bit) {
      _buffer[bufIndex] |= 128 >>> _length % 8;
    }
    _length += 1;
  };
  return _this;
};
var qrNumber = function(data) {
  const _mode = QRMode.MODE_NUMBER;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const data2 = _data;
    let i = 0;
    while (i + 2 < data2.length) {
      buffer.put(strToNum(data2.substring(i, i + 3)), 10);
      i += 3;
    }
    if (i < data2.length) {
      if (data2.length - i == 1) {
        buffer.put(strToNum(data2.substring(i, i + 1)), 4);
      } else if (data2.length - i == 2) {
        buffer.put(strToNum(data2.substring(i, i + 2)), 7);
      }
    }
  };
  const strToNum = function(s) {
    let num = 0;
    for (let i = 0; i < s.length; i += 1) {
      num = num * 10 + chatToNum(s.charAt(i));
    }
    return num;
  };
  const chatToNum = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    }
    throw "illegal char :" + c;
  };
  return _this;
};
var qrAlphaNum = function(data) {
  const _mode = QRMode.MODE_ALPHA_NUM;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const s = _data;
    let i = 0;
    while (i + 1 < s.length) {
      buffer.put(
        getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)),
        11
      );
      i += 2;
    }
    if (i < s.length) {
      buffer.put(getCode(s.charAt(i)), 6);
    }
  };
  const getCode = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    } else if ("A" <= c && c <= "Z") {
      return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
    } else {
      switch (c) {
        case " ":
          return 36;
        case "$":
          return 37;
        case "%":
          return 38;
        case "*":
          return 39;
        case "+":
          return 40;
        case "-":
          return 41;
        case ".":
          return 42;
        case "/":
          return 43;
        case ":":
          return 44;
        default:
          throw "illegal char :" + c;
      }
    }
  };
  return _this;
};
var qr8BitByte = function(data) {
  const _mode = QRMode.MODE_8BIT_BYTE;
  const _data = data;
  const _bytes = qrcode.stringToBytes(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _bytes.length;
  };
  _this.write = function(buffer) {
    for (let i = 0; i < _bytes.length; i += 1) {
      buffer.put(_bytes[i], 8);
    }
  };
  return _this;
};
var qrKanji = function(data) {
  const _mode = QRMode.MODE_KANJI;
  const _data = data;
  const stringToBytes2 = qrcode.stringToBytes;
  !(function(c, code) {
    const test = stringToBytes2(c);
    if (test.length != 2 || (test[0] << 8 | test[1]) != code) {
      throw "sjis not supported.";
    }
  })("\u53CB", 38726);
  const _bytes = stringToBytes2(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return ~~(_bytes.length / 2);
  };
  _this.write = function(buffer) {
    const data2 = _bytes;
    let i = 0;
    while (i + 1 < data2.length) {
      let c = (255 & data2[i]) << 8 | 255 & data2[i + 1];
      if (33088 <= c && c <= 40956) {
        c -= 33088;
      } else if (57408 <= c && c <= 60351) {
        c -= 49472;
      } else {
        throw "illegal char at " + (i + 1) + "/" + c;
      }
      c = (c >>> 8 & 255) * 192 + (c & 255);
      buffer.put(c, 13);
      i += 2;
    }
    if (i < data2.length) {
      throw "illegal char at " + (i + 1);
    }
  };
  return _this;
};
var byteArrayOutputStream = function() {
  const _bytes = [];
  const _this = {};
  _this.writeByte = function(b) {
    _bytes.push(b & 255);
  };
  _this.writeShort = function(i) {
    _this.writeByte(i);
    _this.writeByte(i >>> 8);
  };
  _this.writeBytes = function(b, off, len) {
    off = off || 0;
    len = len || b.length;
    for (let i = 0; i < len; i += 1) {
      _this.writeByte(b[i + off]);
    }
  };
  _this.writeString = function(s) {
    for (let i = 0; i < s.length; i += 1) {
      _this.writeByte(s.charCodeAt(i));
    }
  };
  _this.toByteArray = function() {
    return _bytes;
  };
  _this.toString = function() {
    let s = "";
    s += "[";
    for (let i = 0; i < _bytes.length; i += 1) {
      if (i > 0) {
        s += ",";
      }
      s += _bytes[i];
    }
    s += "]";
    return s;
  };
  return _this;
};
var base64EncodeOutputStream = function() {
  let _buffer = 0;
  let _buflen = 0;
  let _length = 0;
  let _base64 = "";
  const _this = {};
  const writeEncoded = function(b) {
    _base64 += String.fromCharCode(encode(b & 63));
  };
  const encode = function(n) {
    if (n < 0) {
      throw "n:" + n;
    } else if (n < 26) {
      return 65 + n;
    } else if (n < 52) {
      return 97 + (n - 26);
    } else if (n < 62) {
      return 48 + (n - 52);
    } else if (n == 62) {
      return 43;
    } else if (n == 63) {
      return 47;
    } else {
      throw "n:" + n;
    }
  };
  _this.writeByte = function(n) {
    _buffer = _buffer << 8 | n & 255;
    _buflen += 8;
    _length += 1;
    while (_buflen >= 6) {
      writeEncoded(_buffer >>> _buflen - 6);
      _buflen -= 6;
    }
  };
  _this.flush = function() {
    if (_buflen > 0) {
      writeEncoded(_buffer << 6 - _buflen);
      _buffer = 0;
      _buflen = 0;
    }
    if (_length % 3 != 0) {
      const padlen = 3 - _length % 3;
      for (let i = 0; i < padlen; i += 1) {
        _base64 += "=";
      }
    }
  };
  _this.toString = function() {
    return _base64;
  };
  return _this;
};
var base64DecodeInputStream = function(str) {
  const _str = str;
  let _pos = 0;
  let _buffer = 0;
  let _buflen = 0;
  const _this = {};
  _this.read = function() {
    while (_buflen < 8) {
      if (_pos >= _str.length) {
        if (_buflen == 0) {
          return -1;
        }
        throw "unexpected end of file./" + _buflen;
      }
      const c = _str.charAt(_pos);
      _pos += 1;
      if (c == "=") {
        _buflen = 0;
        return -1;
      } else if (c.match(/^\s$/)) {
        continue;
      }
      _buffer = _buffer << 6 | decode(c.charCodeAt(0));
      _buflen += 6;
    }
    const n = _buffer >>> _buflen - 8 & 255;
    _buflen -= 8;
    return n;
  };
  const decode = function(c) {
    if (65 <= c && c <= 90) {
      return c - 65;
    } else if (97 <= c && c <= 122) {
      return c - 97 + 26;
    } else if (48 <= c && c <= 57) {
      return c - 48 + 52;
    } else if (c == 43) {
      return 62;
    } else if (c == 47) {
      return 63;
    } else {
      throw "c:" + c;
    }
  };
  return _this;
};
var gifImage = function(width, height) {
  const _width = width;
  const _height = height;
  const _data = new Array(width * height);
  const _this = {};
  _this.setPixel = function(x, y, pixel) {
    _data[y * _width + x] = pixel;
  };
  _this.write = function(out) {
    out.writeString("GIF87a");
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(128);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(255);
    out.writeByte(255);
    out.writeByte(255);
    out.writeString(",");
    out.writeShort(0);
    out.writeShort(0);
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(0);
    const lzwMinCodeSize = 2;
    const raster = getLZWRaster(lzwMinCodeSize);
    out.writeByte(lzwMinCodeSize);
    let offset = 0;
    while (raster.length - offset > 255) {
      out.writeByte(255);
      out.writeBytes(raster, offset, 255);
      offset += 255;
    }
    out.writeByte(raster.length - offset);
    out.writeBytes(raster, offset, raster.length - offset);
    out.writeByte(0);
    out.writeString(";");
  };
  const bitOutputStream = function(out) {
    const _out = out;
    let _bitLength = 0;
    let _bitBuffer = 0;
    const _this2 = {};
    _this2.write = function(data, length) {
      if (data >>> length != 0) {
        throw "length over";
      }
      while (_bitLength + length >= 8) {
        _out.writeByte(255 & (data << _bitLength | _bitBuffer));
        length -= 8 - _bitLength;
        data >>>= 8 - _bitLength;
        _bitBuffer = 0;
        _bitLength = 0;
      }
      _bitBuffer = data << _bitLength | _bitBuffer;
      _bitLength = _bitLength + length;
    };
    _this2.flush = function() {
      if (_bitLength > 0) {
        _out.writeByte(_bitBuffer);
      }
    };
    return _this2;
  };
  const getLZWRaster = function(lzwMinCodeSize) {
    const clearCode = 1 << lzwMinCodeSize;
    const endCode = (1 << lzwMinCodeSize) + 1;
    let bitLength = lzwMinCodeSize + 1;
    const table = lzwTable();
    for (let i = 0; i < clearCode; i += 1) {
      table.add(String.fromCharCode(i));
    }
    table.add(String.fromCharCode(clearCode));
    table.add(String.fromCharCode(endCode));
    const byteOut = byteArrayOutputStream();
    const bitOut = bitOutputStream(byteOut);
    bitOut.write(clearCode, bitLength);
    let dataIndex = 0;
    let s = String.fromCharCode(_data[dataIndex]);
    dataIndex += 1;
    while (dataIndex < _data.length) {
      const c = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;
      if (table.contains(s + c)) {
        s = s + c;
      } else {
        bitOut.write(table.indexOf(s), bitLength);
        if (table.size() < 4095) {
          if (table.size() == 1 << bitLength) {
            bitLength += 1;
          }
          table.add(s + c);
        }
        s = c;
      }
    }
    bitOut.write(table.indexOf(s), bitLength);
    bitOut.write(endCode, bitLength);
    bitOut.flush();
    return byteOut.toByteArray();
  };
  const lzwTable = function() {
    const _map = {};
    let _size = 0;
    const _this2 = {};
    _this2.add = function(key) {
      if (_this2.contains(key)) {
        throw "dup key:" + key;
      }
      _map[key] = _size;
      _size += 1;
    };
    _this2.size = function() {
      return _size;
    };
    _this2.indexOf = function(key) {
      return _map[key];
    };
    _this2.contains = function(key) {
      return typeof _map[key] != "undefined";
    };
    return _this2;
  };
  return _this;
};
var createDataURL = function(width, height, getPixel) {
  const gif = gifImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gif.setPixel(x, y, getPixel(x, y));
    }
  }
  const b = byteArrayOutputStream();
  gif.write(b);
  const base64 = base64EncodeOutputStream();
  const bytes = b.toByteArray();
  for (let i = 0; i < bytes.length; i += 1) {
    base64.writeByte(bytes[i]);
  }
  base64.flush();
  return "data:image/gif;base64," + base64;
};
var qrcode_default = qrcode;
var stringToBytes = qrcode.stringToBytes;

// src/client/i18n/provider.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var CopyContext = (0, import_react.createContext)(null);
function RemoteAccessI18nProvider({ t, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CopyContext.Provider, { value: t, children });
}
function useRemoteAccessT() {
  const t = (0, import_react.useContext)(CopyContext);
  if (t === null) throw new Error("[dsh-remote-access] useRemoteAccessT \u5FC5\u987B\u5728 RemoteAccessI18nProvider \u5185\u8C03\u7528");
  return t;
}

// src/client/i18n/dictionary.ts
var en = {
  // ── 页面外框 ──
  "\u8FDC\u7A0B\u8BBF\u95EE": "Remote access",
  "\u4E09\u4E2A\u901A\u9053\u72EC\u7ACB\u7EF4\u62A4\u914D\u5BF9\u4E8C\u7EF4\u7801\uFF1A\u626B\u7801/\u6253\u5F00\u94FE\u63A5\u5373\u53EF\u914D\u5BF9\uFF08\u4E00\u6B21\u6027\u4EE4\u724C + \u4F1A\u8BDD Cookie\uFF09\u3002\u6B64\u9875\u9762\u4F9B\u624B\u673A/\u5176\u5B83\u8BBE\u5907\u8FDE\u63A5\u672C\u673A\uFF1B\u82E5\u8981\u5207\u6362\u684C\u9762\u58F3\u81EA\u8EAB\u8FDE\u63A5\u7684 dsh \u670D\u52A1\u6765\u6E90\uFF0C\u8BF7\u7528\u684C\u9762\u8BBE\u7F6E\u7684\u300Cdsh \u670D\u52A1\u5730\u5740\u300D\u3002": "Each channel keeps its own pairing QR code: scan the code or open the link to pair (one-time token plus a session cookie). This page connects phones and other devices to this machine; to change the dsh service the desktop shell itself connects to, use \u201Cdsh service address\u201D in the desktop settings.",
  // ── 局域网通道 ──
  "\u5C40\u57DF\u7F51": "LAN",
  "\u624B\u673A\u8FDE\u540C\u4E00 WiFi\uFF0C\u626B\u6B64\u7801\u76F4\u8FDE\uFF08\u4EC5\u5C40\u57DF\u7F51\u53EF\u8FBE\uFF09\u3002": "Connect the phone to the same Wi-Fi and scan this code to connect directly (LAN only).",
  "\u94F8\u9020\u5C40\u57DF\u7F51\u4EE4\u724C": "Mint LAN token",
  "\u65E0\u6CD5\u786E\u5B9A\u5C40\u57DF\u7F51\u5730\u5740": "Cannot determine the LAN address",
  // ── 通道通用 ──
  "{label} \u914D\u5BF9\u4E8C\u7EF4\u7801": "{label} pairing QR code",
  "\u590D\u5236\u94FE\u63A5": "Copy link",
  "\u5DF2\u590D\u5236 \u2713": "Copied \u2713",
  "10 \u5206\u949F\u6709\u6548 \xB7 \u4E00\u6B21\u6027 \xB7 \u626B\u7801/\u6253\u5F00\u5373\u914D\u5BF9": "Valid for 10 minutes \xB7 single use \xB7 scanning or opening pairs right away",
  "\u94F8\u9020\u5931\u8D25\uFF1A{message}": "Minting failed: {message}",
  // ── 第三方隧道（cpolar 等） ──
  "\u7B2C\u4E09\u65B9\u96A7\u9053\uFF08cpolar \u7B49\uFF09": "Third-party tunnel (cpolar and similar)",
  "\u96A7\u9053\u9700\u6307\u5411\u6539\u5199\u4EE3\u7406\u7AEF\u53E3 127.0.0.1:{port}\uFF1B\u7C98\u8D34\u5730\u5740\u6821\u9A8C\u53EF\u8FBE\u540E\uFF0C\u7528\u6B64\u5730\u5740\u751F\u6210\u81EA\u5DF1\u7684\u914D\u5BF9\u4E8C\u7EF4\u7801\u3002": "The tunnel must point at the rewrite proxy port 127.0.0.1:{port}. Paste the address, verify that it is reachable, then mint a pairing QR code for it.",
  "\u6821\u9A8C\u5E76\u4FDD\u5B58": "Verify and save",
  "\u6821\u9A8C\u4E2D\u2026": "Verifying\u2026",
  "\u8BF7\u8F93\u5165\u96A7\u9053\u5730\u5740": "Enter the tunnel address",
  "\u2713 \u53EF\u8FBE\u5DF2\u4FDD\u5B58\uFF08HTTP {status}\uFF09": "\u2713 Reachable and saved (HTTP {status})",
  "\u2717 \u4E0D\u53EF\u8FBE\uFF1A{reason}": "\u2717 Unreachable: {reason}",
  "\u6821\u9A8C\u5931\u8D25\uFF1A{message}": "Verification failed: {message}",
  "\u94F8\u9020\u96A7\u9053\u4EE4\u724C": "Mint tunnel token",
  "\u8BF7\u5148\u6821\u9A8C\u5E76\u4FDD\u5B58\u96A7\u9053\u5730\u5740": "Verify and save a tunnel address first",
  // ── cloudflared 公网隧道 ──
  "cloudflared \u516C\u7F51\u96A7\u9053": "cloudflared public tunnel",
  "PATH \u6709 cloudflared \u5C31\u76F4\u63A5\u7528\uFF1B\u5426\u5219 ~/.dsh/bin \u7F13\u5B58\u547D\u4E2D\u590D\u7528\uFF1B\u90FD\u6CA1\u6709\u5C31\u4E00\u952E\u4ECE GitHub/ghproxy \u7B49\u591A\u955C\u50CF\u4E0B\u8F7D\u5230\u7F13\u5B58\u3002": "If cloudflared is on PATH it is used directly; otherwise a cached copy in ~/.dsh/bin is reused; if neither exists, one click downloads it from several mirrors (GitHub, ghproxy and others) into the cache.",
  "cloudflared \u5B8C\u6574\u8DEF\u5F84\uFF08\u7559\u7A7A = \u4E00\u952E\u542F\u52A8\uFF09": "Full path to cloudflared (leave empty for one-click start)",
  "\u8FD0\u884C\u4E2D \xB7 {url}": "Running \xB7 {url}",
  "\u8FD0\u884C\u4E2D \xB7 \u7B49\u5F85\u96A7\u9053\u5730\u5740\u2026": "Running \xB7 waiting for the tunnel URL\u2026",
  "\u542F\u52A8\u5931\u8D25\uFF1A{message}": "Start failed: {message}",
  "cloudflared \u65E0\u6CD5\u542F\u52A8": "cloudflared could not start",
  "\u4E0B\u8F7D\u4E2D \xB7 {detail}": "Downloading \xB7 {detail}",
  "\u89E3\u6790\u4E2D \xB7 {detail}": "Resolving \xB7 {detail}",
  "\u542F\u52A8\u4E2D\u2026": "Starting\u2026",
  "\u5DF2\u914D\u7F6E \xB7 \u672A\u8FD0\u884C": "Configured \xB7 not running",
  "\u672A\u914D\u7F6E \xB7 \u672A\u8FD0\u884C": "Not configured \xB7 not running",
  "\u4E00\u952E\u542F\u52A8\uFF08\u65E0\u4F9D\u8D56\uFF09": "One-click start (no dependencies)",
  "\u89E3\u6790\u4E2D \xB7 \u68C0\u67E5 PATH \u4E0E\u672C\u5730\u7F13\u5B58\u2026": "Resolving \xB7 checking PATH and the local cache\u2026",
  "\u4E00\u952E\u542F\u52A8\u5931\u8D25\uFF1A{message}": "One-click start failed: {message}",
  "\u505C\u6B62": "Stop",
  "\u5DF2\u505C\u6B62": "Stopped",
  "\u505C\u6B62\u5931\u8D25\uFF1A{message}": "Stop failed: {message}",
  "\u5E94\u7528\u5E76\u542F\u52A8": "Apply and start",
  "\u5E94\u7528\u4E2D\u2026": "Applying\u2026",
  "\u5E94\u7528\u5931\u8D25\uFF1A{message}": "Apply failed: {message}",
  "\u96A7\u9053\u672A\u8FD0\u884C\u6216\u65E0\u5730\u5740\uFF0C\u8BF7\u5148\u542F\u52A8 cloudflared": "The tunnel is not running or has no URL; start cloudflared first",
  "\u67E5\u8BE2\u5931\u8D25\uFF1A{message}": "Query failed: {message}",
  // ── 已配对设备 ──
  "\u5DF2\u914D\u5BF9\u8BBE\u5907": "Paired devices",
  "\u914D\u5BF9\u670D\u52A1\u4E0D\u53EF\u8FBE\uFF1A{message}": "The pairing service is unreachable: {message}",
  "\u6682\u65E0\u914D\u5BF9\u8BBE\u5907": "No paired devices yet",
  "\u5728\u7EBF": "online",
  "\u79BB\u7EBF": "offline",
  "\u8BBE\u5907\u4FE1\u606F\u5F85\u8865\u5168\uFF08\u8BE5\u8BBE\u5907\u4E0B\u6B21\u8BBF\u95EE\u65F6\u5237\u65B0\uFF09": "Device details will be filled in the next time this device connects",
  "\u79FB\u9664": "Remove",
  "\u79FB\u9664\u5931\u8D25\uFF1A{message}": "Remove failed: {message}"
};
var zh = Object.fromEntries(
  Object.keys(en).map((key) => [key, key])
);

// src/client/i18n/namespace.ts
var REMOTE_ACCESS_NAMESPACE = "dsh-remote-access";

// src/client/i18n/install.ts
function installRemoteAccessCopy(ctx) {
  ctx.effect(() => ctx.locale.register(REMOTE_ACCESS_NAMESPACE, { zh, en }), "dsh-remote-access: dictionaries");
  return ctx.locale.bind(REMOTE_ACCESS_NAMESPACE);
}

// client/remote-device-manager.jsx
var import_react3 = require("react");

// src/host/remote-policy.ts
var REMOTE_WRITES_ENABLED = true;
var REMOTE_READ_INVOKES = /* @__PURE__ */ new Set([
  "session/attachment",
  "fileReferences/list",
  "permissionPresets/catalog",
  "workspaceFiles/list",
  "workspaceFiles/read",
  "workspaceFiles/stat",
  "workspaceFiles/search",
  "workspaceFiles/readBytes"
]);
var REFUSAL_LABELS = {
  "session/prompt": "\u53D1\u9001\u6D88\u606F",
  "session/cancel": "\u505C\u6B62",
  "session/selectModel": "\u5207\u6362\u6A21\u578B",
  "session/rename": "\u91CD\u547D\u540D\u4F1A\u8BDD",
  "session/fork": "\u5206\u53C9\u4F1A\u8BDD",
  "session/updateQueue": "\u8C03\u6574\u6D88\u606F\u961F\u5217",
  "commands/execute": "\u6267\u884C\u547D\u4EE4",
  "session/create": "\u65B0\u5EFA\u4F1A\u8BDD",
  "session/import": "\u5199\u5165\u4F1A\u8BDD",
  "workspace/create": "\u767B\u8BB0\u5DE5\u4F5C\u533A",
  "session/openWorkspacePath": "\u6253\u5F00\u8DEF\u5F84",
  "fileUploads/upload": "\u4E0A\u4F20\u9644\u4EF6",
  "job/kill": "\u7EC8\u6B62\u540E\u53F0\u4EFB\u52A1",
  "terminal/create": "\u6253\u5F00\u7EC8\u7AEF",
  "terminal/attach": "\u6253\u5F00\u7EC8\u7AEF",
  "workspace/archiveSession": "\u5F52\u6863\u4F1A\u8BDD"
};
function decideRemoteInvoke(namespace, method, writesEnabled = REMOTE_WRITES_ENABLED) {
  if (writesEnabled) return "allow";
  return REMOTE_READ_INVOKES.has(`${namespace}/${method}`) ? "allow" : "refuse";
}
function remoteReadonlyRefusal(endpoint) {
  const label = REFUSAL_LABELS[endpoint];
  return label === void 0 ? "\u8FDC\u7A0B\u4F1A\u8BDD\u662F\u53EA\u8BFB\u955C\u50CF\uFF0C\u8FD9\u4E00\u6B65\u8BF7\u5728\u8BBE\u5907\u672C\u673A\u4E0A\u64CD\u4F5C" : `\u8FDC\u7A0B\u4F1A\u8BDD\u662F\u53EA\u8BFB\u955C\u50CF\uFF0C${label}\u8BF7\u5728\u8BBE\u5907\u672C\u673A\u4E0A\u64CD\u4F5C`;
}

// client/open-external.js
async function openInSystemBrowser(url, env = globalThis) {
  const rpc = env.shellChannelRpc;
  if (typeof rpc === "function") {
    try {
      await rpc("shell.invoke", { method: "open_external", params: { url } });
      return "external";
    } catch {
    }
  }
  const open = env.open;
  if (typeof open === "function") {
    const handle = open.call(env, url, "_blank", "noopener,noreferrer");
    if (handle !== null && handle !== void 0) return "window";
    return "window";
  }
  throw new Error("\u5F53\u524D\u73AF\u5883\u65E0\u6CD5\u6253\u5F00\u5916\u90E8\u94FE\u63A5");
}

// client/peer-group.jsx
var import_react2 = require("react");

// client/peer-approvals.js
function peerApprovalModel(request) {
  if (!request || typeof request !== "object" || typeof request.id !== "string" || request.id === "") return null;
  const from = request.from ?? {};
  const introducer = request.introducer ?? {};
  const who = typeof from.name === "string" && from.name !== "" ? from.name : typeof from.origin === "string" ? from.origin : "\u4E00\u53F0\u8BBE\u5907";
  const via = typeof introducer.name === "string" && introducer.name !== "" ? introducer.name : typeof introducer.origin === "string" ? introducer.origin : "";
  return {
    id: request.id,
    text: via === "" ? `\u8BBE\u5907\u300C${who}\u300D\u8BF7\u6C42\u4E0E\u4F60\u914D\u5BF9\u3002` : `\u8BBE\u5907\u300C${who}\u300D\uFF08\u7ECF ${via} \u4ECB\u7ECD\uFF09\u8BF7\u6C42\u4E0E\u4F60\u914D\u5BF9\u3002`,
    detail: "\u540C\u610F\u540E\u53CC\u65B9\u4E92\u76F8\u767B\u8BB0\uFF0C\u53EF\u4EE5\u540C\u6B65\u5F7C\u6B64\u7684\u5DE5\u4F5C\u533A\u4E0E\u4F1A\u8BDD\uFF1B\u62D2\u7EDD\u5219\u5BF9\u65B9\u4EC0\u4E48\u4E5F\u62FF\u4E0D\u5230\u3002",
    actions: [{ id: "reject", label: "\u62D2\u7EDD" }, { id: "approve", label: "\u540C\u610F" }]
  };
}
function keyOf(model) {
  return model === null ? "" : `${model.id}:${model.text}`;
}
function mountPeerApprovalCard(model, handlers) {
  const composer = document.querySelector('[contenteditable="true"][role="textbox"]') ?? document.querySelector("textarea");
  const host = composer?.parentElement ?? document.querySelector('[role="tree"][aria-label="\u4F1A\u8BDD"]')?.parentElement?.parentElement ?? null;
  if (!host || !model) return null;
  const root = document.createElement("div");
  root.setAttribute("data-dsh-remote-peer-approval", model.id);
  root.setAttribute("role", "alertdialog");
  root.setAttribute("aria-label", "\u914D\u5BF9\u8BF7\u6C42");
  root.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:10px",
    "flex-wrap:wrap",
    "margin:0 0 8px",
    "padding:10px 12px",
    "border-radius:10px",
    "border:1px solid var(--dsw-alias-label-primary, #e7eaf0)",
    "font-size:12px",
    "color:inherit",
    "background:var(--dsw-alias-background, transparent)"
  ].join(";");
  const text = document.createElement("div");
  text.style.cssText = "flex:1;min-width:0;";
  const title = document.createElement("p");
  title.style.cssText = "margin:0;font-weight:600;";
  title.textContent = model.text;
  const detail = document.createElement("p");
  detail.style.cssText = "margin:2px 0 0;color:var(--dsw-alias-label-secondary, #9aa4b2);";
  detail.textContent = model.detail;
  text.appendChild(title);
  text.appendChild(detail);
  root.appendChild(text);
  for (const action of model.actions) {
    const button2 = document.createElement("button");
    button2.type = "button";
    button2.setAttribute("data-dsh-remote-peer-action", action.id);
    button2.textContent = action.label;
    button2.style.cssText = [
      "font:inherit",
      "font-size:12px",
      "padding:4px 12px",
      "border-radius:8px",
      "cursor:pointer",
      action.id === "approve" ? "border:1px solid var(--dsw-alias-label-primary, #e7eaf0);background:transparent;color:inherit;font-weight:600;" : "border:1px solid var(--dsw-alias-border-secondary, #3a3a3f);background:transparent;color:inherit;"
    ].join(";");
    button2.addEventListener("click", () => handlers.onAction(action.id));
    root.appendChild(button2);
  }
  host.insertBefore(root, host.firstChild);
  return () => {
    root.remove();
  };
}
function installPeerApprovals(options = {}) {
  if (typeof document === "undefined") return () => {
  };
  const hostCall2 = options.hostCall;
  const intervalMs = options.intervalMs ?? 2e3;
  const mount = options.mount ?? mountPeerApprovalCard;
  const toast = options.toast ?? (() => {
  });
  let shown = "";
  let unmount = null;
  let busy = false;
  const dismiss = () => {
    if (unmount !== null) {
      unmount();
      unmount = null;
    }
    shown = "";
  };
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      let requests = [];
      try {
        const state = await hostCall2("remotePeer.pending");
        requests = Array.isArray(state?.requests) ? state.requests : [];
      } catch {
        requests = [];
      }
      const model = requests.length === 0 ? null : peerApprovalModel(requests[0]);
      const key = keyOf(model);
      if (key === shown) return;
      dismiss();
      if (model === null) return;
      const mounted = mount(model, {
        onAction: (action) => {
          void (async () => {
            try {
              await hostCall2("remotePeer.decide", { id: model.id, approve: action === "approve" });
              toast(action === "approve" ? "\u5DF2\u540C\u610F\uFF0C\u5BF9\u65B9\u6B63\u5728\u5B8C\u6210\u914D\u5BF9" : "\u5DF2\u62D2\u7EDD\u8FD9\u6B21\u914D\u5BF9\u8BF7\u6C42");
            } catch (error) {
              toast(`\u6CA1\u6709\u5904\u7406\u6210\u529F\uFF1A${String(error?.message ?? error)}`);
            } finally {
              dismiss();
              void tick();
            }
          })();
        }
      });
      if (mounted !== null && mounted !== void 0) {
        unmount = mounted;
        shown = key;
      }
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  return () => {
    clearInterval(timer);
    dismiss();
  };
}
function peerGroupState(peer) {
  if (!peer || typeof peer !== "object") return { kind: "idle", text: "" };
  if (peer.paired === true) return { kind: "paired", text: "\u5DF2\u914D\u5BF9" };
  if (peer.request === "pending") return { kind: "pending", text: "\u7B49\u5F85\u5BF9\u65B9\u786E\u8BA4\u2026" };
  if (peer.request === "failed") return { kind: "failed", text: peer.detail ?? "\u8BF7\u6C42\u6CA1\u6709\u9001\u5230" };
  if (peer.request === "expired") return { kind: "expired", text: "\u5BF9\u65B9\u6CA1\u6709\u5904\u7406\uFF0C\u53EF\u4EE5\u91CD\u65B0\u8BF7\u6C42" };
  return { kind: "idle", text: "" };
}

// client/peer-group.jsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var labelStyle = { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)" };
var buttonStyle = {
  font: "inherit",
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer"
};
function PeerGroup({ hostCall: hostCall2, host }) {
  const [peers, setPeers] = (0, import_react2.useState)(null);
  const [notice, setNotice] = (0, import_react2.useState)("");
  const refresh = (0, import_react2.useCallback)(async () => {
    try {
      const state = await hostCall2("remotePeers.list", { hostId: host.hostId });
      const list = Array.isArray(state?.peers) ? state.peers : [];
      let changed = false;
      for (const peer of list) {
        if (peer?.request !== "pending") continue;
        try {
          const progress = await hostCall2("remotePeers.status", { hostId: host.hostId, deviceId: peer.deviceId });
          if (typeof progress?.state === "string" && progress.state !== "pending") {
            changed = true;
            setNotice(progress.state === "paired" ? `\u5DF2\u548C ${peer.name} \u5B8C\u6210\u914D\u5BF9\uFF0C\u4E24\u8FB9\u4E92\u76F8\u767B\u8BB0` : String(progress.message ?? "\u5BF9\u65B9\u6CA1\u6709\u540C\u610F"));
          }
        } catch {
        }
      }
      if (!changed) {
        setPeers(list);
        return;
      }
      const again = await hostCall2("remotePeers.list", { hostId: host.hostId });
      setPeers(Array.isArray(again?.peers) ? again.peers : list);
    } catch {
    }
  }, [hostCall2, host.hostId]);
  (0, import_react2.useEffect)(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 3e3);
    return () => clearInterval(timer);
  }, [refresh]);
  const request = async (peer) => {
    setNotice(`\u6B63\u5728\u5411 ${peer.name} \u53D1\u8D77\u914D\u5BF9\u8BF7\u6C42\u2026`);
    try {
      const result = await hostCall2("remotePeers.request", { hostId: host.hostId, deviceId: peer.deviceId });
      setNotice(result?.state === "pending" ? `\u5DF2\u5411 ${peer.name} \u53D1\u8D77\u8BF7\u6C42\uFF0C\u7B49\u5F85\u5BF9\u65B9\u786E\u8BA4\u2026` : String(result?.message ?? "\u8BF7\u6C42\u6CA1\u6709\u9001\u5230"));
    } catch (error) {
      setNotice(String(error?.message ?? error));
    }
    await refresh();
  };
  if (peers === null) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      "data-dsh-remote-peer-group": host.hostId,
      style: { marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--dsw-alias-border-secondary, #3a3a3f)" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 }, children: "\u540C\u7EC4\u8BBE\u5907\uFF08\u7ECF\u8FD9\u4F4D\u8BBE\u5907\u4ECB\u7ECD\uFF09" }),
        peers.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: labelStyle, children: "\u8FD9\u4F4D\u8BBE\u5907\u540D\u4E0B\u8FD8\u6CA1\u6709\u522B\u7684\u8BBE\u5907\u3002" }) : peers.map((peer) => {
          const state = peerGroupState(peer);
          const askable = state.kind === "idle" || state.kind === "expired";
          const stale = typeof peer.lastSeen === "number" && peer.lastSeen > 0 && Date.now() - peer.lastSeen > 10 * 6e4;
          return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "div",
            {
              "data-dsh-remote-peer": peer.deviceId,
              "data-dsh-remote-peer-state": state.kind,
              style: { display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", fontSize: 13 },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: peer.name }),
                state.text !== "" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: labelStyle, role: state.kind === "failed" ? "alert" : void 0, children: state.text }) : null,
                stale && state.kind !== "paired" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: labelStyle, title: "\u4ECB\u7ECD\u4EBA\u5DF2\u7ECF\u8D85\u8FC7 10 \u5206\u949F\u6CA1\u8FDE\u4E0A\u8FD9\u53F0\u8BBE\u5907\uFF0C\u5B83\u53EF\u80FD\u65E9\u5DF2\u4E0D\u5728\u7EBF", children: "\u5F88\u4E45\u672A\u5728\u7EBF" }) : null,
                askable ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: buttonStyle, onClick: () => {
                  void request(peer);
                }, children: "\u8BF7\u6C42\u914D\u5BF9" }) : null
              ]
            },
            peer.deviceId
          );
        }),
        notice !== "" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "status", style: { ...labelStyle, marginTop: 6 }, children: notice }) : null
      ]
    }
  );
}

// client/remote-device-manager.jsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var cardStyle = {
  border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)",
  borderRadius: 10,
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 10
};
var inputStyle = {
  // border-box：width:100% 时 padding 与边框算在宽度内，否则输入框会撑出外层卡片。
  boxSizing: "border-box",
  width: "100%",
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)",
  background: "transparent",
  color: "inherit",
  fontSize: 13
};
var buttonStyle2 = {
  font: "inherit",
  fontSize: 13,
  padding: "6px 11px",
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer"
};
var primaryStyle = {
  ...buttonStyle2,
  borderColor: "var(--dsw-alias-label-primary, #e7eaf0)",
  fontWeight: 500
};
var ghostStyle = {
  ...buttonStyle2,
  borderColor: "transparent",
  color: "var(--dsw-alias-label-secondary, #9aa4b2)"
};
var dangerStyle = {
  ...buttonStyle2,
  borderColor: "transparent",
  color: "#e5484d"
};
var STATE_COLOR = { online: "#16a34a", offline: "#9ca3af", unpaired: "#f59e0b", incompatible: "#ef4444" };
function Chevron({ open }) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "span",
    {
      "aria-hidden": "true",
      style: {
        display: "inline-block",
        width: 0,
        height: 0,
        borderTop: "4px solid transparent",
        borderBottom: "4px solid transparent",
        borderLeft: "5px solid currentColor",
        transform: open ? "rotate(90deg)" : "none",
        transition: "transform 160ms ease-out",
        opacity: 0.6
      }
    }
  );
}
function RemoteDeviceManager({ hostCall: hostCall2 }) {
  const [hosts, setHosts] = (0, import_react3.useState)([]);
  const [states, setStates] = (0, import_react3.useState)({});
  const [workspaces, setWorkspaces] = (0, import_react3.useState)([]);
  const [sessions, setSessions] = (0, import_react3.useState)({});
  const [open, setOpen] = (0, import_react3.useState)({});
  const [renaming, setRenaming] = (0, import_react3.useState)(null);
  const [draft, setDraft] = (0, import_react3.useState)("");
  const [addr, setAddr] = (0, import_react3.useState)("");
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [openingWebui, setOpeningWebui] = (0, import_react3.useState)("");
  const [notice, setNotice] = (0, import_react3.useState)(null);
  const [notes, setNotes] = (0, import_react3.useState)({});
  const refresh = (0, import_react3.useCallback)(async () => {
    try {
      const [hostState, wsState] = await Promise.all([
        hostCall2("remoteHosts.list"),
        hostCall2("remoteWorkspace.list")
      ]);
      const list = Array.isArray(hostState?.hosts) ? hostState.hosts : [];
      setHosts(list);
      setWorkspaces(Array.isArray(wsState?.workspaces) ? wsState.workspaces : []);
      const next = {};
      const described = {};
      await Promise.all(list.map(async (host) => {
        try {
          const result = await hostCall2("remoteStatus.probe", { hostId: host.hostId });
          const state = result?.status?.state;
          if (typeof state === "string") next[host.hostId] = state;
          const note = typeof result?.description === "string" ? result.description : "";
          if (note !== "") described[host.hostId] = note;
        } catch {
        }
      }));
      setStates(next);
      setNotes(described);
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    }
  }, [hostCall2]);
  (0, import_react3.useEffect)(() => {
    void refresh();
  }, [refresh]);
  const loadSessions = async (hostId, path) => {
    try {
      const result = await hostCall2("remoteSessions.list", { hostId, path });
      setSessions((prev) => ({ ...prev, [hostId + "|" + path]: Array.isArray(result?.sessions) ? result.sessions : [] }));
    } catch {
      setSessions((prev) => ({ ...prev, [hostId + "|" + path]: [] }));
    }
  };
  const toggle = (hostId) => {
    const next = !open[hostId];
    setOpen((prev) => ({ ...prev, [hostId]: next }));
    if (next) {
      for (const workspace of workspaces.filter((w) => w.hostId === hostId)) {
        void loadSessions(hostId, workspace.path);
      }
    }
  };
  const addDevice = async () => {
    const value = addr.trim();
    if (value === "") {
      setNotice({ kind: "error", text: "\u8BF7\u5148\u7C98\u8D34\u8FDE\u63A5\u5730\u5740" });
      return;
    }
    setBusy(true);
    setNotice({ kind: "info", text: "\u6B63\u5728\u8FDE\u63A5\u2026" });
    try {
      const url = new URL(value.replace(/^dsh:\/\//, "http://"));
      const token = url.searchParams.get("token") ?? "";
      const origin = url.origin;
      if (token === "") throw new Error("\u5730\u5740\u91CC\u6CA1\u6709 token");
      await hostCall2("remoteHosts.pair", { origin, token });
      setAddr("");
      setNotice({ kind: "ok", text: "\u8FDE\u63A5\u6210\u529F\uFF0C\u53CC\u65B9\u5DF2\u4E92\u76F8\u767B\u8BB0" });
      await refresh();
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    } finally {
      setBusy(false);
    }
  };
  const rename = async (hostId) => {
    const name = draft.trim();
    setRenaming(null);
    if (name === "") return;
    try {
      await hostCall2("remoteHosts.rename", { hostId, name });
      await refresh();
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    }
  };
  const openWebui = async (hostId) => {
    setOpeningWebui(hostId);
    setNotice({ kind: "info", text: "\u6B63\u5728\u5411\u8BBE\u5907\u7D22\u53D6\u6253\u5F00\u5730\u5740\u2026" });
    try {
      const result = await hostCall2("remoteWebui.open", { hostId });
      const url = typeof result?.url === "string" ? result.url : "";
      if (url === "") throw new Error("\u8BBE\u5907\u6CA1\u6709\u8FD4\u56DE\u53EF\u6253\u5F00\u7684\u5730\u5740");
      await openInSystemBrowser(url);
      setNotice({ kind: "ok", text: "\u5DF2\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u8BE5\u8BBE\u5907\u7684 DSH" });
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    } finally {
      setOpeningWebui("");
    }
  };
  const reconnect = async (hostId) => {
    try {
      const result = await hostCall2("remoteStatus.probe", { hostId });
      const state = result?.status?.state;
      if (typeof state === "string") setStates((prev) => ({ ...prev, [hostId]: state }));
      const note = typeof result?.description === "string" ? result.description : "";
      if (note !== "") setNotes((prev) => ({ ...prev, [hostId]: note }));
      setNotice({ kind: state === "online" ? "ok" : "info", text: note === "" ? String(state ?? "") : note });
    } catch (error) {
      setStates((prev) => ({ ...prev, [hostId]: "offline" }));
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    }
  };
  const [confirming, setConfirming] = (0, import_react3.useState)(null);
  const remove = async (hostId) => {
    try {
      await hostCall2("remoteHosts.remove", { hostId });
      await refresh();
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    }
  };
  const archiveSession = async (sessionId) => {
    try {
      await hostCall2("remoteSession.invoke", {
        namespace: "workspace",
        method: "archiveSession",
        args: { request: { sessionId } }
      });
      await refresh();
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: cardStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 13, fontWeight: 600 }, children: "\u65B0\u589E\u8BBE\u5907" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", lineHeight: 1.6 }, children: "\u7C98\u8D34\u5BF9\u7AEF lane \u94F8\u9020\u7684\u8FDE\u63A5\u5730\u5740\u3002\u8FDE\u63A5\u6210\u529F\u624D\u4F1A\u6DFB\u52A0\u2014\u2014\u6DFB\u52A0\u540E\u53CC\u65B9\u4E92\u76F8\u767B\u8BB0\uFF0C\u4EFB\u4F55\u4E00\u65B9\u90FD\u80FD\u53D1\u8D77\u4F1A\u8BDD\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "input",
        {
          style: inputStyle,
          value: addr,
          placeholder: "dsh://192.168.1.42:3091/pair?token=...",
          onChange: (event) => setAddr(event.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", style: primaryStyle, disabled: busy, onClick: addDevice, children: "\u8FDE\u63A5\u5E76\u6DFB\u52A0" }),
        notice !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontSize: 12, color: notice.kind === "error" ? "#e5484d" : notice.kind === "ok" ? "#16a34a" : "var(--dsw-alias-label-secondary, #9aa4b2)" }, children: notice.text }) : null
      ] })
    ] }),
    hosts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: cardStyle, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }, children: "\u8FD8\u6CA1\u6709\u6DFB\u52A0\u4EFB\u4F55\u8BBE\u5907\u3002" }) }) : null,
    hosts.map((host) => {
      const state = states[host.hostId] ?? "offline";
      const isOpen = open[host.hostId] === true;
      const mine = workspaces.filter((workspace) => workspace.hostId === host.hostId);
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { ...cardStyle, padding: 0, gap: 0, overflow: "hidden" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "div",
          {
            style: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer" },
            onClick: () => toggle(host.hostId),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { width: 8, height: 8, borderRadius: "50%", background: STATE_COLOR[state] ?? "#9ca3af", flex: "none" } }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }, children: [
                  renaming === host.hostId ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    "input",
                    {
                      style: { ...inputStyle, width: 200, padding: "2px 6px", fontSize: 14, fontWeight: 600 },
                      value: draft,
                      autoFocus: true,
                      onChange: (event) => setDraft(event.target.value),
                      onBlur: () => void rename(host.hostId),
                      onKeyDown: (event) => {
                        if (event.key === "Enter") void rename(host.hostId);
                      },
                      onClick: (event) => event.stopPropagation()
                    }
                  ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: host.renamedAt !== void 0 && host.name !== "" ? host.name : host.origin }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { title: notes[host.hostId] ?? "", style: { fontSize: 11, padding: "1px 7px", borderRadius: 999, border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)", color: STATE_COLOR[state] ?? "#9ca3af" }, children: state === "online" ? "\u5DF2\u8FDE\u63A5" : state === "unpaired" ? "\u672A\u914D\u5BF9" : state === "incompatible" ? "\u7248\u672C\u4E0D\u7B26" : "\u5DF2\u65AD\u5F00" })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", marginTop: 3 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: host.origin }),
                  host.model ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: host.model }) : null,
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
                    "ID ",
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("code", { style: { fontFamily: "var(--font-mono, monospace)", fontSize: 11 }, children: host.deviceId })
                  ] })
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", style: ghostStyle, onClick: (event) => {
                event.stopPropagation();
                setRenaming(host.hostId);
                setDraft(host.name ?? "");
              }, children: "\u91CD\u547D\u540D" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  style: ghostStyle,
                  disabled: state !== "online" || busy || openingWebui !== "",
                  title: state === "online" ? "\u7528\u7CFB\u7EDF\u6D4F\u89C8\u5668\u6253\u5F00\u8FD9\u53F0\u8BBE\u5907\u7684 DSH\uFF08\u5730\u5740\u7531\u5BF9\u65B9\u7B7E\u53D1\uFF0C\u4E00\u6B21\u6027\u6709\u6548\uFF09" : notes[host.hostId] ?? "\u8BBE\u5907\u79BB\u7EBF\u65F6\u65E0\u6CD5\u6253\u5F00",
                  onClick: (event) => {
                    event.stopPropagation();
                    void openWebui(host.hostId);
                  },
                  children: openingWebui === host.hostId ? "\u6B63\u5728\u6253\u5F00\u2026" : "\u5728\u6D4F\u89C8\u5668\u6253\u5F00"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", style: ghostStyle, onClick: (event) => {
                event.stopPropagation();
                void reconnect(host.hostId);
              }, children: "\u91CD\u8FDE" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", style: dangerStyle, onClick: (event) => {
                event.stopPropagation();
                setConfirming({ kind: "device", id: host.hostId, label: host.renamedAt !== void 0 && host.name !== "" ? host.name : host.origin });
              }, children: "\u5220\u9664" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Chevron, { open: isOpen })
            ]
          }
        ),
        isOpen ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { borderTop: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)", padding: "12px 14px" }, children: [
          mine.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }, children: "\u8FD9\u53F0\u8BBE\u5907\u4E0A\u8FD8\u6CA1\u6709\u767B\u8BB0\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u3002" }) : null,
          mine.map((workspace) => {
            const key = host.hostId + "|" + workspace.path;
            const rows = sessions[key];
            return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { marginBottom: 12 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, marginBottom: 4 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: workspace.title }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }, children: workspace.path })
              ] }),
              rows === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", padding: "4px 8px" }, children: "\u52A0\u8F7D\u4E2D\u2026" }) : rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", padding: "4px 8px" }, children: "\u8FD9\u4E2A\u5DE5\u4F5C\u533A\u8FD8\u6CA1\u6709\u4F1A\u8BDD" }) : rows.map((session) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, fontSize: 13 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: session.title || session.id }),
                REMOTE_WRITES_ENABLED ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", style: dangerStyle, onClick: () => setConfirming({ kind: "session", id: session.id, label: session.title || session.id }), children: "\u5F52\u6863" }) : null
              ] }, session.id))
            ] }, workspace.path);
          }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(PeerGroup, { hostCall: hostCall2, host })
        ] }) : null
      ] }, host.hostId);
    }),
    confirming !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "div",
      {
        style: { position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" },
        onClick: () => setConfirming(null),
        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "div",
          {
            style: { width: 380, maxWidth: "90vw", padding: 18, borderRadius: 12, background: "var(--dsw-alias-bg-layer-1, #171a21)", border: "1px solid var(--dsw-alias-border-l2, #2a2f3a)", display: "flex", flexDirection: "column", gap: 12 },
            onClick: (event) => event.stopPropagation(),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 14, fontWeight: 600 }, children: confirming.kind === "device" ? "\u5220\u9664\u8BBE\u5907" : "\u5F52\u6863\u4F1A\u8BDD" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontSize: 13, lineHeight: 1.6, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }, children: confirming.kind === "device" ? `\u786E\u5B9A\u5220\u9664\u300C${confirming.label}\u300D\uFF1F\u8FD9\u53F0\u8BBE\u5907\u7684\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u767B\u8BB0\u4F1A\u4E00\u5E76\u79FB\u9664\uFF0C\u5BF9\u7AEF\u4E0D\u53D7\u5F71\u54CD\u3002` : `\u786E\u5B9A\u5F52\u6863\u300C${confirming.label}\u300D\uFF1F\u5F52\u6863\u540E\u5B83\u4F1A\u4ECE\u4FA7\u8FB9\u680F\u6D88\u5931\u3002` }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", style: buttonStyle2, onClick: () => setConfirming(null), children: "\u53D6\u6D88" }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                  "button",
                  {
                    type: "button",
                    style: { ...buttonStyle2, borderColor: "#e5484d", color: "#e5484d" },
                    onClick: async () => {
                      const target = confirming;
                      setConfirming(null);
                      if (target.kind === "device") await remove(target.id);
                      else await archiveSession(target.id);
                    },
                    children: confirming.kind === "device" ? "\u5220\u9664" : "\u5F52\u6863"
                  }
                )
              ] })
            ]
          }
        )
      }
    ) : null
  ] });
}

// client/remote-sync-menu.jsx
var import_react4 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// client/share-menu-visibility.js
function shouldHideShareMenu(sessionId, remoteSessions) {
  if (typeof sessionId !== "string" || sessionId === "") return false;
  if (!(remoteSessions instanceof Set)) return false;
  return remoteSessions.has(sessionId);
}

// client/share-dialog.js
var Z = 9999;
var css = {
  overlay: `position:fixed;inset:0;z-index:${Z};display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28);`,
  panel: "display:flex;flex-direction:column;gap:12px;width:380px;max-width:calc(100vw - 32px);padding:16px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 12px 32px rgba(0,0,0,.18);font-size:13px;",
  label: "display:flex;flex-direction:column;gap:4px;",
  hint: "color:var(--dsw-alias-label-secondary);font-size:12px;",
  input: "box-sizing:border-box;width:100%;padding:6px 10px;border-radius:8px;font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);",
  footer: "display:flex;justify-content:flex-end;gap:8px;",
  button: "box-sizing:border-box;padding:6px 12px;border-radius:8px;font:inherit;cursor:pointer;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);",
  primary: "box-sizing:border-box;padding:6px 12px;border-radius:8px;font:inherit;cursor:pointer;border:none;background:var(--dsw-alias-brand-1,#4d6bfe);color:#fff;",
  noticeError: "font-size:12px;color:#ef4444;",
  noticeOk: "font-size:12px;color:#16a34a;"
};
function element(tag, style, text) {
  const node = document.createElement(tag);
  if (style !== void 0) node.style.cssText = style;
  if (text !== void 0) node.textContent = text;
  return node;
}
function openShareDialog({ sessionId, hostCall: hostCall2, mode = "share", onChanged }) {
  const previous = document.querySelector("[data-dsh-remote-share-dialog]");
  if (previous !== null) previous.remove();
  const overlay = element("div", css.overlay);
  overlay.setAttribute("data-dsh-remote-share-dialog", "1");
  const panel = element("div", css.panel);
  overlay.appendChild(panel);
  panel.appendChild(element("div", "font-weight:600;", mode === "manage" ? "\u5206\u4EAB\u7BA1\u7406" : "\u5206\u4EAB\u5230\u8FDC\u7A0B"));
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  const notice = element("div", css.noticeError);
  notice.style.display = "none";
  const say = (kind, text) => {
    notice.style.cssText = kind === "ok" ? css.noticeOk : css.noticeError;
    notice.style.display = "block";
    notice.textContent = text;
  };
  if (mode === "manage") {
    const list = element("div", "display:flex;flex-direction:column;gap:8px;");
    panel.appendChild(list);
    const footer2 = element("div", css.footer);
    const closeButton = element("button", css.button, "\u5173\u95ED");
    closeButton.type = "button";
    closeButton.addEventListener("click", close);
    footer2.appendChild(closeButton);
    panel.appendChild(notice);
    panel.appendChild(footer2);
    const refresh = async () => {
      list.textContent = "";
      try {
        const state = await hostCall2("remoteShare.list", { sessionId });
        const shares = Array.isArray(state?.shares) ? state.shares : [];
        if (shares.length === 0) {
          list.appendChild(element("div", "opacity:.7;", "\u8FD8\u6CA1\u6709\u5206\u4EAB\u7ED9\u4EFB\u4F55\u8BBE\u5907\u3002"));
          return;
        }
        for (const share of shares) {
          const row = element("div", "display:flex;align-items:center;gap:8px;");
          row.appendChild(element("span", "flex:1;", share.deviceId));
          row.appendChild(element("span", "opacity:.6;font-size:12px;", share.viewers > 0 ? "\u5728\u7EBF" : "\u79BB\u7EBF"));
          const remove = element("button", css.button, "\u64A4\u9500");
          remove.type = "button";
          remove.addEventListener("click", async () => {
            remove.disabled = true;
            try {
              await hostCall2("remoteShare.remove", { sessionId, deviceId: share.deviceId });
              await refresh();
              onChanged?.();
            } catch (error) {
              say("error", String(error?.message ?? error));
            } finally {
              remove.disabled = false;
            }
          });
          row.appendChild(remove);
          list.appendChild(row);
        }
      } catch (error) {
        say("error", String(error?.message ?? error));
      }
    };
    void refresh();
    document.body.appendChild(overlay);
    return;
  }
  const deviceLabel = element("label", css.label);
  deviceLabel.appendChild(element("span", css.hint, "\u76EE\u6807\u8BBE\u5907"));
  const select = element("select", css.input);
  deviceLabel.appendChild(select);
  panel.appendChild(deviceLabel);
  const pathLabel = element("label", css.label);
  pathLabel.appendChild(element("span", css.hint, "\u5BF9\u7AEF\u9879\u76EE\u76EE\u5F55"));
  const pathInput = element("input", css.input);
  pathInput.placeholder = "/path/to/project";
  pathLabel.appendChild(pathInput);
  panel.appendChild(pathLabel);
  const footer = element("div", css.footer);
  const cancel = element("button", css.button, "\u53D6\u6D88");
  cancel.type = "button";
  cancel.addEventListener("click", close);
  const confirm = element("button", css.primary, "\u786E\u8BA4\u5206\u4EAB");
  confirm.type = "button";
  footer.appendChild(cancel);
  footer.appendChild(confirm);
  panel.appendChild(notice);
  panel.appendChild(footer);
  let deviceId = "";
  const syncConfirm = () => {
    confirm.disabled = deviceId === "" || pathInput.value.trim() === "";
  };
  syncConfirm();
  void (async () => {
    try {
      const state = await hostCall2("devices.list");
      const devices = Array.isArray(state?.devices) ? state.devices : [];
      select.textContent = "";
      if (devices.length === 0) {
        select.appendChild(element("option", void 0, "\uFF08\u8FD8\u6CA1\u6709\u5DF2\u914D\u5BF9\u8BBE\u5907\uFF09"));
        select.value = "";
      } else {
        for (const device of devices) {
          const option = element("option", void 0, device.name || device.deviceId);
          option.value = device.deviceId;
          select.appendChild(option);
        }
        deviceId = devices[0].deviceId;
        select.value = deviceId;
      }
      syncConfirm();
    } catch (error) {
      say("error", String(error?.message ?? error));
    }
    try {
      const state = await hostCall2("remoteWorkspace.list");
      const workspaces = Array.isArray(state?.workspaces) ? state.workspaces : [];
      const match = workspaces.find((entry) => entry.sessionIds?.includes?.(sessionId));
      if (typeof match?.path === "string") pathInput.value = match.path;
    } catch {
    }
    syncConfirm();
  })();
  select.addEventListener("change", () => {
    deviceId = select.value;
    syncConfirm();
  });
  pathInput.addEventListener("input", syncConfirm);
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    confirm.textContent = "\u5206\u4EAB\u4E2D\u2026";
    try {
      await hostCall2("remoteShare.add", { sessionId, deviceId, path: pathInput.value.trim() });
      onChanged?.();
      close();
    } catch (error) {
      say("error", String(error?.message ?? error));
      confirm.textContent = "\u786E\u8BA4\u5206\u4EAB";
      syncConfirm();
    }
  });
  document.body.appendChild(overlay);
  pathInput.focus();
}

// client/remote-sync-menu.jsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function ShareIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("path", { d: "M8 9.5v-8M5 4.5l3-3 3 3", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("path", { d: "M2.5 7v5.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V7", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" })
  ] });
}
function RemoteSyncMenu({ sessionId, hostCall: hostCall2, dismiss }) {
  const [mode, setMode] = (0, import_react4.useState)(null);
  const [devices, setDevices] = (0, import_react4.useState)([]);
  const [deviceId, setDeviceId] = (0, import_react4.useState)("");
  const [path, setPath] = (0, import_react4.useState)("");
  const [shares, setShares] = (0, import_react4.useState)([]);
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [notice, setNotice] = (0, import_react4.useState)(null);
  const loadShares = async () => {
    try {
      const state = await hostCall2("remoteShare.list", { sessionId });
      setShares(Array.isArray(state?.shares) ? state.shares : []);
    } catch {
      setShares([]);
    }
  };
  (0, import_react4.useEffect)(() => {
    void loadShares();
  }, [sessionId]);
  (0, import_react4.useEffect)(() => {
    if (mode !== "share") return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await hostCall2("devices.list");
        if (cancelled) return;
        const list = Array.isArray(state?.devices) ? state.devices : [];
        setDevices(list);
        if (list.length > 0) setDeviceId((current) => current === "" ? list[0].deviceId : current);
      } catch {
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, hostCall2]);
  const openShare = () => {
    setNotice(null);
    setMode("share");
    void (async () => {
      try {
        const state = await hostCall2("remoteWorkspace.list");
        const list = Array.isArray(state?.workspaces) ? state.workspaces : [];
        const match = list.find((entry) => entry.sessionIds?.includes?.(sessionId));
        if (typeof match?.path === "string") setPath(match.path);
      } catch {
      }
    })();
  };
  const confirmShare = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await hostCall2("remoteShare.add", { sessionId, deviceId, path });
      await loadShares();
      setNotice({ kind: "ok", text: "\u5DF2\u5206\u4EAB" });
      setMode(null);
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (target) => {
    setBusy(true);
    try {
      await hostCall2("remoteShare.remove", { sessionId, deviceId: target });
      await loadShares();
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    } finally {
      setBusy(false);
    }
  };
  const remoteSet = globalThis.__DSH_REMOTE_SESSIONS__;
  if (shouldHideShareMenu(sessionId, globalThis.__DSH_REMOTE_SESSIONS__)) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives.MenuItemButton, { icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ShareIcon, {}), onSelect: () => openShareDialog({ sessionId, hostCall: hostCall2, onChanged: loadShares }), children: "\u5206\u4EAB\u5230\u8FDC\u7A0B\u2026" }),
    shares.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_dsh_client_ui_primitives.MenuItemButton, { icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(ShareIcon, {}), onSelect: () => openShareDialog({ sessionId, hostCall: hostCall2, mode: "manage", onChanged: loadShares }), children: [
      "\u5206\u4EAB\u7BA1\u7406\uFF08",
      shares.length,
      "\uFF09"
    ] }) : null
  ] });
}

// client/remote-directory-flow.jsx
var import_react5 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime5 = require("react/jsx-runtime");
var columnStyle = { display: "flex", flexDirection: "column", gap: 12 };
var pathRowStyle = { display: "flex", gap: 8, alignItems: "center", width: "100%" };
var pathInputStyle = {
  flex: "1 1 auto",
  minWidth: 0,
  height: 32,
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 35%, transparent)",
  background: "transparent",
  color: "var(--dsw-alias-label-primary)",
  font: "inherit",
  fontSize: 13,
  outline: "none"
};
var listStyle = { display: "flex", flexDirection: "column", maxHeight: 220, overflowY: "auto" };
var rowButtonStyle = { justifyContent: "flex-start" };
var chipsStyle = { display: "flex", flexWrap: "wrap", gap: 8 };
function parentOf(target) {
  if (typeof target !== "string" || target === "") return "";
  const trimmed = target.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut <= 0 ? "/" : trimmed.slice(0, cut);
}
function segmentsOf(target) {
  if (typeof target !== "string" || target === "") return [];
  const trimmed = target.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/).filter((part) => part !== "");
  const out = [{ name: "/", path: "/" }];
  let acc = "";
  for (const part of parts) {
    acc = acc + "/" + part;
    out.push({ name: part, path: acc });
  }
  return out;
}
function RemoteDirectoryFlow(props) {
  const { open, busy, onPicked, onCancel, onError, hostCall: hostCall2, pick } = props;
  const t = useRemoteAccessT();
  const [source, setSource] = (0, import_react5.useState)("local");
  const [hosts, setHosts] = (0, import_react5.useState)([]);
  const [hostId, setHostId] = (0, import_react5.useState)("");
  const [listing, setListing] = (0, import_react5.useState)(null);
  const [current, setCurrent] = (0, import_react5.useState)("");
  const [draft, setDraft] = (0, import_react5.useState)("");
  const [error, setError] = (0, import_react5.useState)(null);
  const [working, setWorking] = (0, import_react5.useState)(false);
  const [link, setLink] = (0, import_react5.useState)(null);
  const browse = (0, import_react5.useCallback)(async (targetHostId, targetPath, quiet = false) => {
    if (targetHostId === "") return;
    if (link !== null && targetHostId === hostId) return;
    setWorking(true);
    if (!quiet) setError(null);
    try {
      const result = await hostCall2("remoteWorkspace.browse", { hostId: targetHostId, path: targetPath });
      setListing(result);
      const next = result?.path ?? targetPath;
      setCurrent(next);
      setDraft(next);
      setError(null);
    } catch (reason) {
      if (!quiet) {
        const raw = String(reason?.message ?? reason);
        setError(/HTTP 5\d\d|list-failed|not-found|ENOENT|ENOTDIR/.test(raw) ? `${t("\u76EE\u5F55\u4E0D\u5B58\u5728\u6216\u65E0\u6CD5\u8BBF\u95EE")}\uFF1A${targetPath}` : raw);
      }
    } finally {
      setWorking(false);
    }
  }, [hostCall2, t, link, hostId]);
  const browseRef = (0, import_react5.useRef)(browse);
  browseRef.current = browse;
  (0, import_react5.useEffect)(() => {
    if (!open) return;
    setError(null);
    setListing(null);
    setCurrent("");
    void (async () => {
      try {
        const state = await hostCall2("remoteHosts.list");
        const list = Array.isArray(state?.hosts) ? state.hosts : [];
        setHosts(list);
        const first = list[0]?.hostId ?? "";
        setHostId(first);
        if (first !== "") await browseRef.current(first, "");
      } catch (reason) {
        setError(String(reason?.message ?? reason));
      }
    })();
  }, [open, hostCall2]);
  (0, import_react5.useEffect)(() => {
    if (!open || hostId === "") return;
    let cancelled = false;
    setLink(null);
    void (async () => {
      let next = null;
      try {
        const result = await hostCall2("remoteStatus.probe", { hostId });
        const state = typeof result?.status?.state === "string" ? result.status.state : "offline";
        if (state !== "online") next = { state, reason: typeof result?.description === "string" ? result.description : "\u8FDE\u4E0D\u4E0A\u8BBE\u5907\uFF0C\u53EF\u91CD\u8BD5" };
      } catch {
        next = { state: "offline", reason: "\u8FDE\u4E0D\u4E0A\u8BBE\u5907\uFF0C\u53EF\u91CD\u8BD5" };
      }
      if (cancelled) return;
      setLink(next);
      if (next !== null) {
        setError(null);
        setListing(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, hostId, hostCall2]);
  (0, import_react5.useEffect)(() => {
    if (!open || hostId === "" || draft === "" || draft === current) return;
    if (!draft.startsWith("/")) return;
    const timer = setTimeout(() => {
      void browse(hostId, draft, true);
    }, 400);
    return () => clearTimeout(timer);
  }, [open, hostId, draft, current, browse]);
  if (!open) return null;
  const commit = async () => {
    if (current === "" || hostId === "") return;
    setWorking(true);
    setError(null);
    try {
      await hostCall2("remoteWorkspace.add", { hostId, path: current });
      globalThis.__DSH_REMOTE_BADGE_REFRESH__?.();
      onPicked(current);
    } catch (reason) {
      const message = String(reason?.message ?? reason);
      setError(message);
      onError(message);
    } finally {
      setWorking(false);
    }
  };
  const pickLocalDirectory = async () => {
    try {
      const picked = await pick();
      if (picked === null || picked === void 0) onCancel();
      else onPicked(picked);
    } catch (reason) {
      onError(String(reason?.message ?? reason));
    }
  };
  const tabs = [
    { value: "local", label: t("\u672C\u673A"), id: "dsh-rdf-tab-local", panelId: "dsh-rdf-panel-local" },
    { value: "remote", label: t("\u8FDC\u7A0B\u8BBE\u5907"), id: "dsh-rdf-tab-remote", panelId: "dsh-rdf-panel-remote" }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
    import_dsh_client_ui_primitives2.Modal,
    {
      open,
      onClose: onCancel,
      title: t("\u6DFB\u52A0\u5DE5\u4F5C\u533A"),
      closeLabel: t("\u5173\u95ED"),
      description: t("\u9009\u4E00\u4E2A\u672C\u673A\u76EE\u5F55\uFF0C\u6216\u4ECE\u5DF2\u914D\u5BF9\u7684\u4E3B\u673A\u4E0A\u6311\u4E00\u4E2A\u76EE\u5F55\u3002"),
      footer: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", onClick: onCancel, children: t("\u53D6\u6D88") }),
        source === "remote" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          import_dsh_client_ui_primitives2.Button,
          {
            variant: "primary",
            onClick: () => void commit(),
            disabled: busy || working || current === "" || hostId === "" || link !== null,
            children: t("\u4F7F\u7528\u6B64\u76EE\u5F55")
          }
        ) : null
      ] }),
      children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: columnStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives2.SegmentedTabs, { items: tabs, value: source, onChange: setSource, label: t("\u76EE\u5F55\u6765\u6E90"), size: "sm" }),
        source === "local" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { id: "dsh-rdf-panel-local", role: "tabpanel", "aria-labelledby": "dsh-rdf-tab-local", style: columnStyle, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "primary", onClick: () => void pickLocalDirectory(), disabled: busy, children: t("\u9009\u62E9\u672C\u673A\u76EE\u5F55\u2026") }) }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { id: "dsh-rdf-panel-remote", role: "tabpanel", "aria-labelledby": "dsh-rdf-tab-remote", style: columnStyle, children: [
          hosts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { children: t("\u8FD8\u6CA1\u6709\u5DF2\u914D\u5BF9\u7684\u4E3B\u673A\u3002\u5148\u5230\u300C\u8BBE\u7F6E \u2192 \u8FDC\u7A0B\u8BBF\u95EE\u300D\u914D\u5BF9\u4E00\u53F0\uFF0C\u518D\u56DE\u6765\u6DFB\u52A0\u5B83\u7684\u76EE\u5F55\u3002") }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: chipsStyle, children: hosts.map((host) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
              import_dsh_client_ui_primitives2.Button,
              {
                variant: host.hostId === hostId ? "primary" : "outline",
                size: "sm",
                onClick: () => {
                  setHostId(host.hostId);
                  void browse(host.hostId, "");
                },
                children: host.name || host.origin || host.hostId
              },
              host.hostId
            )) }),
            link === null ? null : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { role: "alert", style: { opacity: 0.85 }, children: [
              t("\u8FD9\u53F0\u8BBE\u5907\u73B0\u5728\u8FDE\u4E0D\u4E0A\uFF0C\u6682\u4E0D\u80FD\u5728\u5B83\u4E0A\u9762\u6DFB\u52A0\u5DE5\u4F5C\u533A\uFF1A"),
              link.reason
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("nav", { "aria-label": t("\u5F53\u524D\u8DEF\u5F84"), style: chipsStyle, children: segmentsOf(current).map((segment) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
              import_dsh_client_ui_primitives2.Button,
              {
                variant: "ghost",
                size: "sm",
                onClick: () => void browse(hostId, segment.path),
                children: segment.name
              },
              segment.path
            )) }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: pathRowStyle, children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "input",
                {
                  value: draft,
                  "aria-label": t("\u76EE\u5F55\u8DEF\u5F84"),
                  placeholder: t("\u7C98\u8D34\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u4F8B\u5982 /Users/you/project"),
                  onChange: (event) => setDraft(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === "Enter") void browse(hostId, draft);
                  },
                  style: pathInputStyle
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "outline", size: "sm", disabled: working || draft === "" || link !== null, onClick: () => void browse(hostId, draft), children: t("\u524D\u5F80") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: listStyle, children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", style: rowButtonStyle, onClick: () => void browse(hostId, parentOf(current)), children: t(".. \u4E0A\u4E00\u7EA7") }),
              (listing?.entries ?? []).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                import_dsh_client_ui_primitives2.Button,
                {
                  variant: "ghost",
                  size: "sm",
                  style: rowButtonStyle,
                  onClick: () => void browse(hostId, entry.path),
                  children: entry.name
                },
                entry.path
              )),
              (listing?.entries ?? []).length === 0 && !working ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { children: t("\uFF08\u6CA1\u6709\u5B50\u76EE\u5F55\uFF09") }) : null
            ] })
          ] }),
          error === null ? null : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { children: error })
        ] })
      ] })
    }
  );
}

// client/workspace-badge.js
var BADGE_ATTR = "data-dsh-remote-workspace";
var BADGE_PREFIX = "\u8FDC\u7A0B";
var STATE_COLORS = {
  online: "#16a34a",
  offline: "#9ca3af",
  unpaired: "#f59e0b",
  incompatible: "#ef4444"
};
function paintBadge(label, text, title, state, host = label.parentElement ?? label) {
  const color = STATE_COLORS[state] ?? "";
  const existing = host.querySelector(`[${BADGE_ATTR}]`);
  if (existing !== null) {
    if (existing.getAttribute("title") !== title) existing.setAttribute("title", title);
    const dot2 = existing.querySelector("[data-dsh-remote-dot]");
    const caption2 = existing.querySelector("[data-dsh-remote-text]");
    if (caption2 !== null && caption2.textContent !== text) caption2.textContent = text;
    if (dot2 !== null) dot2.style.background = color === "" ? "currentColor" : color;
    return;
  }
  const badge = document.createElement("span");
  badge.setAttribute(BADGE_ATTR, "1");
  const dot = document.createElement("span");
  dot.setAttribute("data-dsh-remote-dot", "1");
  dot.style.cssText = [
    "display:inline-block",
    "width:5px",
    "height:5px",
    "border-radius:50%",
    "margin-inline-end:4px",
    "vertical-align:middle",
    `background:${color === "" ? "currentColor" : color}`
  ].join(";");
  const caption = document.createElement("span");
  caption.setAttribute("data-dsh-remote-text", "1");
  caption.textContent = text;
  badge.style.cssText = [
    "display:inline-block",
    "margin-inline-start:6px",
    "padding:0 5px",
    "border-radius:999px",
    "border:1px solid currentColor",
    "font-size:10px",
    "line-height:13px",
    "font-weight:500",
    "letter-spacing:0.02em",
    "opacity:0.55",
    "color:var(--dsw-alias-label-tertiary)",
    "vertical-align:middle",
    "white-space:nowrap",
    "pointer-events:none",
    "user-select:none",
    "flex:none",
    "max-width:96px",
    "overflow:hidden",
    "text-overflow:ellipsis"
  ].join(";");
  badge.append(dot, caption);
  host.appendChild(badge);
}
function installRemoteWorkspaceBadge({ hostCall: hostCall2, intervalMs = 0 }) {
  if (typeof document === "undefined") return () => {
  };
  let titles = /* @__PURE__ */ new Map();
  let hostIds = /* @__PURE__ */ new Map();
  let states = /* @__PURE__ */ new Map();
  let reasons = /* @__PURE__ */ new Map();
  let sources = /* @__PURE__ */ new Map();
  let shareCounts = /* @__PURE__ */ new Map();
  let stopped = false;
  let observer = null;
  let source = null;
  const repaint = () => {
    if (stopped || titles.size === 0) return;
    for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
      const key = row.getAttribute("data-row-key") ?? "";
      const workspaceId = key.slice("workspace:".length);
      const entry = titles.get(workspaceId);
      if (entry === void 0) continue;
      const name = entry.name;
      const state = states.get(entry.hostId);
      const offline = state === "offline";
      if (entry.claimed === true) {
        paintBadge(row, `${String(entry.claimCount)} \u53F0\u8BBE\u5907`, name, "online", row);
        continue;
      }
      const shortName = name !== "" && !name.startsWith("http") ? name : "";
      const shortOrigin = name.startsWith("http") ? name.replace(/^https?:\/\//, "") : "";
      const caption = shortName !== "" ? shortName : shortOrigin;
      row.style.opacity = offline ? "0.55" : "";
      const reason = offline ? reasons.get(entry.hostId) ?? "\u8BBE\u5907\u79BB\u7EBF\uFF0C\u53EF\u91CD\u8BD5" : "";
      paintBadge(row, caption === "" ? BADGE_PREFIX : `${BADGE_PREFIX} \xB7 ${caption}`, reason === "" ? name : `${name}\uFF1A${reason}\uFF1B\u4F1A\u8BDD\u4ECD\u53EF\u67E5\u770B`, state, row);
    }
  };
  const repaintShares = () => {
    if (stopped || shareCounts.size === 0) return;
    for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
      const key = row.getAttribute("data-row-key") ?? "";
      const sessionId = key.slice("session:".length);
      const count = shareCounts.get(sessionId);
      if (count === void 0 || count === 0) continue;
      paintBadge(row, `\u5206\u4EAB \xB7 ${count}`, `\u5DF2\u5206\u4EAB\u7ED9 ${count} \u53F0\u8BBE\u5907`, "online", row);
    }
  };
  const repaintBranches = () => {
    const branches = globalThis.__DSH_REMOTE_BRANCHES__;
    if (stopped || !(branches instanceof Map) || branches.size === 0) return;
    for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
      const key = row.getAttribute("data-row-key") ?? "";
      const origin = branches.get(key.slice("session:".length));
      if (typeof origin !== "string") continue;
      paintBadge(row, "\u672C\u5730\u5206\u652F", origin, "online", row);
    }
  };
  const SOURCE_ATTR = "data-dsh-remote-source";
  const repaintSources = () => {
    if (stopped || sources.size === 0) return;
    for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
      const key = row.getAttribute("data-row-key") ?? "";
      const source2 = sources.get(key.slice("session:".length));
      if (source2 === void 0) continue;
      const color = STATE_COLORS[states.get(source2.hostId)] ?? "";
      const shown = source2.name.replace(/^https?:\/\//, "");
      let dot = row.querySelector(`[${SOURCE_ATTR}]`);
      if (dot === null) {
        dot = document.createElement("span");
        dot.setAttribute(SOURCE_ATTR, "1");
        dot.style.cssText = [
          "display:inline-block",
          "width:6px",
          "height:6px",
          "border-radius:50%",
          "margin-inline-end:5px",
          "flex:none",
          "vertical-align:middle"
        ].join(";");
        row.insertBefore(dot, row.firstChild);
      }
      dot.style.background = color === "" ? "currentColor" : color;
      dot.setAttribute("title", `\u6765\u81EA ${shown}`);
    }
  };
  const refresh = async () => {
    try {
      const state = await hostCall2("remoteWorkspace.list");
      const list = Array.isArray(state?.workspaces) ? state.workspaces : [];
      const next = /* @__PURE__ */ new Map();
      const hostIdsNext = /* @__PURE__ */ new Set();
      for (const workspace of list) {
        if (typeof workspace?.title !== "string" || workspace.title === "") continue;
        const name = typeof workspace.hostName === "string" && workspace.hostName !== "" ? workspace.hostName : typeof workspace.hostOrigin === "string" ? workspace.hostOrigin : "";
        const hostId = typeof workspace.hostId === "string" ? workspace.hostId : "";
        const workspaceId = typeof workspace.id === "string" ? workspace.id : "";
        if (workspaceId === "") continue;
        const previous = next.get(workspaceId);
        next.set(workspaceId, { name, hostId, claimed: workspace.claimed === true || previous?.claimed === true, claimCount: typeof workspace.claimCount === "number" ? workspace.claimCount : 0, path: typeof workspace.path === "string" && workspace.path !== "" ? workspace.path : previous?.path ?? "", localDirectory: workspace.localDirectory === true || workspace.claimed === true || previous?.localDirectory === true });
        if (hostId !== "") hostIdsNext.add(hostId);
      }
      titles = next;
      hostIds = hostIdsNext;
      const remoteIds = /* @__PURE__ */ new Set();
      for (const workspace of list) {
        for (const sessionId of workspace?.sessionIds ?? []) {
          if (typeof sessionId === "string" && sessionId !== "") remoteIds.add(sessionId);
        }
      }
      globalThis.__DSH_REMOTE_SESSIONS__ = remoteIds;
      globalThis.__DSH_REMOTE_WORKSPACES__ = new Set(next.keys());
      globalThis.__DSH_REMOTE_ONLY_WORKSPACES__ = new Set([...next].filter(([, entry]) => entry.localDirectory !== true).map(([id]) => id));
      globalThis.__DSH_REMOTE_WORKSPACE_PATHS__ = new Set(list.filter((workspace) => workspace?.claimed !== true && workspace.localDirectory !== true && typeof workspace?.path === "string" && workspace.path !== "").map((workspace) => workspace.path));
      const nextSources = /* @__PURE__ */ new Map();
      for (const workspace of list) {
        if (workspace?.claimed === true) continue;
        const hostId = typeof workspace.hostId === "string" ? workspace.hostId : "";
        const name = typeof workspace.hostName === "string" && workspace.hostName !== "" ? workspace.hostName : "";
        for (const sessionId of workspace?.sessionIds ?? []) {
          if (typeof sessionId === "string" && sessionId !== "") nextSources.set(sessionId, { name, hostId });
        }
      }
      sources = nextSources;
      const probed = /* @__PURE__ */ new Map();
      const described = /* @__PURE__ */ new Map();
      await Promise.all([...hostIds].map(async (hostId) => {
        try {
          const result = await hostCall2("remoteStatus.probe", { hostId });
          const state2 = result?.status?.state;
          if (typeof state2 === "string") probed.set(hostId, state2);
          if (typeof result?.description === "string") described.set(hostId, result.description);
        } catch {
          probed.set(hostId, "offline");
          described.set(hostId, "\u8FDE\u4E0D\u4E0A\u8BBE\u5907\uFF0C\u53EF\u91CD\u8BD5");
        }
      }));
      states = probed;
      reasons = described;
      try {
        const shareState = await hostCall2("remoteShare.list", {});
        const shares = Array.isArray(shareState?.shares) ? shareState.shares : [];
        const counts = /* @__PURE__ */ new Map();
        for (const share of shares) {
          if (typeof share?.sessionId !== "string") continue;
          counts.set(share.sessionId, (counts.get(share.sessionId) ?? 0) + 1);
        }
        shareCounts = counts;
      } catch {
      }
      repaint();
      repaintShares();
      repaintSources();
      repaintBranches();
    } catch (error) {
      try {
        console.warn("dsh-remote-access: \u5FBD\u6807\u5237\u65B0\u5931\u8D25\uFF1A" + String(error && error.message ? error.message : error));
      } catch {
      }
    }
  };
  void refresh();
  setTimeout(() => {
    void refresh();
  }, 1200);
  setTimeout(() => {
    void refresh();
  }, 4e3);
  globalThis.__DSH_REMOTE_BADGE_REFRESH__ = () => {
    void refresh();
  };
  globalThis.__DSH_REMOTE_LINK__ = (target) => {
    const workspaceId = target && typeof target.workspaceId === "string" ? target.workspaceId : "";
    const path = target && typeof target.path === "string" ? target.path : "";
    let hostId = "";
    if (workspaceId !== "" && titles.has(workspaceId)) hostId = titles.get(workspaceId).hostId;
    else if (path !== "") {
      for (const entry of titles.values()) {
        if (entry.path === path) {
          hostId = entry.hostId;
          break;
        }
      }
    }
    if (hostId === "") return null;
    const state = states.get(hostId);
    if (state === void 0) return null;
    return { state, reason: reasons.get(hostId) ?? "\u8FDE\u4E0D\u4E0A\u8BBE\u5907\uFF0C\u53EF\u91CD\u8BD5" };
  };
  let waiting = true;
  const waitLoop = async () => {
    while (waiting && !stopped) {
      try {
        const result = await hostCall2("remoteEvents.wait", {});
        if (Array.isArray(result?.events) && result.events.length > 0) await refresh();
      } catch {
        await new Promise((resolve) => {
          setTimeout(resolve, 3e3);
        });
      }
    }
  };
  void waitLoop();
  const onVisible = () => {
    if (document.visibilityState === "visible") void refresh();
  };
  document.addEventListener("visibilitychange", onVisible);
  observer = new MutationObserver(() => {
    repaint();
    repaintSources();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    waiting = false;
    document.removeEventListener("visibilitychange", onVisible);
    observer?.disconnect();
    for (const node of document.querySelectorAll(`[${BADGE_ATTR}], [data-dsh-remote-source]`)) node.remove();
    for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) row.style.opacity = "";
  };
}

// client/sidebar-source-filter.js
var SIDEBAR_SOURCES = Object.freeze([
  { value: "all", label: "\u5168\u90E8" },
  { value: "local", label: "\u672C\u5730" },
  { value: "remote", label: "\u8FDC\u7A0B" }
]);
var DEFAULT_SIDEBAR_SOURCE = "all";
var SOURCE_BAR_ATTRIBUTE = "data-dsh-remote-source-bar";
var HIDDEN_ATTRIBUTE = "data-dsh-remote-source-hidden";
function parseSidebarSource(value) {
  return SIDEBAR_SOURCES.some((item) => item.value === value) ? value : DEFAULT_SIDEBAR_SOURCE;
}
function sidebarSourceStorageKey(profile) {
  const scope = typeof profile === "string" && profile !== "" ? profile : "default";
  return `dsh-remote-access.sidebar-source:${scope}`;
}
function workspaceIdOfRowKey(rowKey) {
  return typeof rowKey === "string" && rowKey.startsWith("workspace:") ? rowKey.slice("workspace:".length) : "";
}
function isRemoteWorkspace(workspaceId, known) {
  return workspaceId !== "" && known?.workspaces instanceof Set && known.workspaces.has(workspaceId);
}
function rowVisibleInSource(source, isRemote) {
  if (source === "local") return !isRemote;
  if (source === "remote") return isRemote;
  return true;
}
function detectThemeDropdown(root) {
  if (!root) return null;
  const doc = root.querySelector ? root.querySelector("html")?.ownerDocument ?? void 0 : void 0;
  const document_ = typeof root.evaluate === "function" ? root : doc;
  if (document_ && typeof document_.evaluate === "function") {
    try {
      const result = document_.evaluate(
        '//*[@*[starts-with(name(.), "data-dsh-claude-")]]',
        document_.documentElement ?? document_,
        null,
        0,
        // XPathResult.ORDERED_NODE_ITERATOR_TYPE 的常量值；不直接引用全局，便于测试环境
        null
      );
      const hit = result?.iterateNext?.();
      if (!hit) return null;
      for (const attr of hit.attributes ?? []) if (attr.name.startsWith("data-dsh-claude-")) return attr.name;
      return "data-dsh-claude-";
    } catch {
    }
  }
  if (typeof root.querySelectorAll !== "function") return null;
  for (const element2 of root.querySelectorAll("*")) {
    for (const attr of element2?.attributes ?? []) {
      if (attr.name.startsWith("data-dsh-claude-")) return attr.name;
    }
  }
  return null;
}
function installSidebarSourceFilter(options = {}) {
  if (typeof document === "undefined") return () => {
  };
  const hostCall2 = options.hostCall;
  const intervalMs = typeof options.intervalMs === "number" ? options.intervalMs : 3e3;
  const log = typeof options.log === "function" ? options.log : (message) => {
    try {
      console.info("[dsh-remote-access] " + message);
    } catch {
    }
  };
  let source = DEFAULT_SIDEBAR_SOURCE;
  let storageKey = sidebarSourceStorageKey(void 0);
  let bar = null;
  let fallbackLogged = false;
  let injectedLogged = false;
  let pending = false;
  let stopped = false;
  const readSaved = () => {
    try {
      source = parseSidebarSource(localStorage.getItem(storageKey));
    } catch {
    }
  };
  const save = () => {
    try {
      localStorage.setItem(storageKey, source);
    } catch {
    }
  };
  readSaved();
  void (async () => {
    try {
      const info = typeof hostCall2 === "function" ? await hostCall2("info") : null;
      if (typeof info?.profile === "string" && info.profile !== "") {
        storageKey = sidebarSourceStorageKey(info.profile);
        readSaved();
        paint();
      }
    } catch {
    }
  })();
  const knownRemote = () => ({ workspaces: globalThis.__DSH_REMOTE_WORKSPACES__, sessions: globalThis.__DSH_REMOTE_SESSIONS__ });
  const findTree = () => document.querySelector('[role="tree"][aria-label="\u4F1A\u8BDD"]');
  const setHidden = (element2, hidden) => {
    if (hidden) {
      if (element2.hasAttribute(HIDDEN_ATTRIBUTE)) return;
      element2.setAttribute(HIDDEN_ATTRIBUTE, "1");
      element2.style.display = "none";
      return;
    }
    if (!element2.hasAttribute(HIDDEN_ATTRIBUTE)) return;
    element2.removeAttribute(HIDDEN_ATTRIBUTE);
    element2.style.display = "";
  };
  const restoreAll = (scope) => {
    for (const element2 of (scope ?? document).querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)) setHidden(element2, false);
  };
  const isRemoteSessionRow = (row, known) => {
    const key = row.getAttribute("data-row-key") ?? "";
    return key.startsWith("session:") && known.sessions instanceof Set && known.sessions.has(key.slice("session:".length));
  };
  const ensureBar = (tree) => {
    const body = tree.parentElement;
    const owner = body?.parentElement;
    const anchor = owner && owner !== document.body ? owner : body;
    if (!anchor) return null;
    if (bar && bar.isConnected && bar.parentElement === anchor) return bar;
    if (bar === null) {
      const existing = document.querySelector(`[${SOURCE_BAR_ATTRIBUTE}]`);
      if (existing !== null) {
        bar = existing;
        bar.replaceChildren();
      }
    }
    if (bar === null) {
      bar = document.createElement("div");
      bar.setAttribute(SOURCE_BAR_ATTRIBUTE, "1");
      bar.setAttribute("role", "tablist");
      bar.setAttribute("aria-label", "\u5DE5\u4F5C\u533A\u6765\u6E90");
      bar.style.cssText = "display:flex;gap:4px;padding:4px 10px;flex:none;";
    }
    if (bar.childElementCount === 0) {
      for (const item of SIDEBAR_SOURCES) {
        const button2 = document.createElement("button");
        button2.type = "button";
        button2.setAttribute("role", "tab");
        button2.setAttribute("data-source", item.value);
        button2.textContent = item.label;
        button2.style.cssText = "font:inherit;font-size:12px;padding:2px 10px;border-radius:999px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;";
        button2.addEventListener("click", () => setSource(item.value));
        bar.appendChild(button2);
      }
    }
    anchor.insertBefore(bar, anchor.firstChild);
    if (!injectedLogged) {
      injectedLogged = true;
      log("\u4FA7\u680F\u5DF2\u6CE8\u5165\u300C\u672C\u5730 / \u8FDC\u7A0B / \u5168\u90E8\u300D\u5207\u6362");
    }
    return bar;
  };
  const paintBar = () => {
    if (!bar) return;
    for (const button2 of bar.querySelectorAll("button[data-source]")) {
      const active = button2.getAttribute("data-source") === source;
      button2.setAttribute("aria-selected", active ? "true" : "false");
      button2.style.fontWeight = active ? "600" : "400";
      button2.style.borderColor = active ? "var(--dsw-alias-label-primary, #e7eaf0)" : "transparent";
    }
  };
  const setSource = (value) => {
    source = parseSidebarSource(value);
    save();
    paint();
    try {
      globalThis.__DSH_REMOTE_BADGE_REFRESH__?.();
    } catch {
    }
    log(`\u4FA7\u680F\u6765\u6E90\u5207\u6362\u4E3A\u300C${SIDEBAR_SOURCES.find((item) => item.value === source)?.label ?? source}\u300D`);
  };
  const paint = () => {
    if (stopped) return;
    const tree = findTree();
    if (!tree) return;
    const theme = detectThemeDropdown(document);
    if (theme !== null) {
      restoreAll(tree);
      if (bar?.isConnected) bar.remove();
      if (!fallbackLogged) {
        fallbackLogged = true;
        injectedLogged = false;
        log(`\u68C0\u6D4B\u5230\u4E3B\u9898\u63D2\u4EF6\u7684\u5206\u7EC4\u4E0B\u62C9\uFF08${theme}\uFF09\uFF0C\u4E0D\u6CE8\u5165\u6765\u6E90\u5207\u6362\uFF0C\u56DE\u9000\u4E3A\u5355\u5217\u8868 + \u8BBE\u5907\u5FBD\u6807`);
      }
      return;
    }
    if (fallbackLogged) {
      fallbackLogged = false;
      log("\u4E3B\u9898\u63D2\u4EF6\u7684\u5206\u7EC4\u4E0B\u62C9\u5DF2\u4E0D\u5728\uFF0C\u6062\u590D\u300C\u672C\u5730 / \u8FDC\u7A0B / \u5168\u90E8\u300D\u5207\u6362");
    }
    ensureBar(tree);
    paintBar();
    if (source === "all") {
      restoreAll(tree);
      return;
    }
    const known = knownRemote();
    for (const section of tree.children) {
      const header = section.querySelector?.('[data-row-key^="workspace:"]');
      if (header) {
        const remote = isRemoteWorkspace(workspaceIdOfRowKey(header.getAttribute("data-row-key")), known);
        setHidden(section, !rowVisibleInSource(source, remote));
        continue;
      }
      for (const row of section.querySelectorAll?.('[data-row-key^="session:"]') ?? []) {
        setHidden(row, !rowVisibleInSource(source, isRemoteSessionRow(row, known)));
      }
    }
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      paint();
    });
  };
  const observer = typeof MutationObserver === "function" ? new MutationObserver(schedule) : null;
  const start = () => {
    const tree = findTree();
    if (tree && observer) observer.observe(tree, { childList: true, subtree: true });
    paint();
  };
  start();
  const timer = setInterval(() => {
    if (observer) {
      observer.disconnect();
      start();
    } else paint();
  }, intervalMs);
  setTimeout(paint, 1200);
  setTimeout(paint, 4e3);
  return () => {
    stopped = true;
    clearInterval(timer);
    observer?.disconnect();
    if (bar?.isConnected) bar.remove();
    restoreAll();
  };
}

// client/composer-restore.js
var COMPOSER_SELECTORS = [
  "[data-dsh-composer-input]",
  "textarea[data-dsh-composer]",
  "textarea",
  '[contenteditable="true"]'
];
function findComposer() {
  for (const selector of COMPOSER_SELECTORS) {
    const nodes = Array.from(document.querySelectorAll(selector));
    const usable = nodes.filter((node) => node instanceof HTMLElement && node.offsetParent !== null);
    if (usable.length > 0) return usable[usable.length - 1];
  }
  return void 0;
}
function writeTextarea(element2, text) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  if (descriptor === void 0 || descriptor.set === void 0) return false;
  descriptor.set.call(element2, text);
  element2.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
function writeEditable(element2, text) {
  element2.textContent = text;
  element2.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
  return true;
}
function restoreComposer(text) {
  if (typeof text !== "string" || text.trim() === "") return false;
  const composer = findComposer();
  if (composer === void 0) return false;
  const written = composer instanceof HTMLTextAreaElement ? writeTextarea(composer, text) : writeEditable(composer, text);
  if (!written) return false;
  composer.focus();
  return true;
}

// client/remote-toast.js
var CONTAINER_ATTR = "data-dsh-remote-toast";
var DURATION_MS = 6e3;
var containerStyle = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9998;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;";
var pillStyle = "max-width:min(560px,calc(100vw - 48px));padding:8px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(28,28,30,.92));color:var(--dsw-alias-label-primary,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));box-shadow:0 8px 24px rgba(0,0,0,.24);font-size:13px;line-height:20px;";
function container() {
  let node = document.querySelector("[" + CONTAINER_ATTR + "]");
  if (node !== null) return node;
  node = document.createElement("div");
  node.setAttribute(CONTAINER_ATTR, "1");
  node.style.cssText = containerStyle;
  document.body.appendChild(node);
  return node;
}
function showRemoteToast(text) {
  const host = container();
  const pill = document.createElement("div");
  pill.style.cssText = pillStyle;
  pill.textContent = text;
  host.appendChild(pill);
  const timer = setTimeout(() => {
    pill.remove();
  }, DURATION_MS);
  return () => {
    clearTimeout(timer);
    pill.remove();
  };
}

// client/interaction-card.js
var COPY = {
  questionTitle: "\u6765\u81EA\u8BBE\u5907\u672C\u673A\u7684\u63D0\u95EE",
  approvalTitle: "\u9700\u8981\u4F60\u786E\u8BA4",
  approve: "\u5141\u8BB8\u4E00\u6B21",
  reject: "\u62D2\u7EDD",
  skip: "\u8DF3\u8FC7",
  submit: "\u63D0\u4EA4\u56DE\u7B54",
  customPlaceholder: "\u5176\u4ED6\uFF08\u53EF\u9009\uFF0C\u81EA\u7531\u586B\u5199\uFF09",
  handedBack: "\u8FD9\u4E00\u9879\u5DF2\u7ECF\u4EA4\u56DE\u8BBE\u5907\u672C\u673A\u5904\u7406\u3002",
  approvalQuestion: (toolName) => `\u662F\u5426\u5141\u8BB8\u6267\u884C\u300C${toolName}\u300D\uFF1F`,
  approveDescription: (toolName) => `\u53EA\u5141\u8BB8\u8FD9\u4E00\u6B21\uFF1A${toolName}`,
  rejectDescription: "\u4E0D\u6267\u884C\u8FD9\u4E00\u6B65",
  submitBusy: "\u6B63\u5728\u9001\u8FBE\u2026"
};
function questionModel(question) {
  return {
    id: question.id,
    header: typeof question.header === "string" ? question.header : "",
    question: typeof question.question === "string" ? question.question : "",
    detail: typeof question.detail === "string" ? question.detail : "",
    multiSelect: question.multiSelect === true,
    options: Array.isArray(question.options) ? question.options.map((option) => ({ label: option?.label, description: typeof option?.description === "string" ? option.description : "" })).filter((option) => typeof option.label === "string" && option.label !== "") : []
  };
}
function cardModel(interaction) {
  const handedBack = interaction?.handedBack === true;
  if (interaction?.type === "approval") {
    const toolName = typeof interaction.toolName === "string" ? interaction.toolName : "";
    return {
      requestId: interaction.requestId,
      kind: "approval",
      handedBack,
      title: COPY.approvalTitle,
      toolName,
      reason: typeof interaction.reason === "string" && interaction.reason !== "" ? interaction.reason : COPY.approvalQuestion(toolName)
    };
  }
  const questions = Array.isArray(interaction?.questions) ? interaction.questions : [];
  return {
    requestId: interaction?.requestId ?? "",
    kind: "question",
    handedBack,
    title: COPY.questionTitle,
    questions: questions.map(questionModel)
  };
}
function cardForSession(interactions, sessionId) {
  if (!Array.isArray(interactions) || typeof sessionId !== "string" || sessionId === "") return null;
  return interactions.find((item) => item?.sessionId === sessionId && typeof item.requestId === "string") ?? null;
}
function selectedLabels(node) {
  return Array.from(node.querySelectorAll("button[data-option][aria-pressed='true']")).map((button2) => button2.getAttribute("data-option") || "");
}
function buildQuestionAnswer(model, root, skip = false) {
  const answers = model.questions.map((question) => {
    const field = root.querySelector(`[data-question='${question.id}']`);
    const custom = skip ? "" : (field?.querySelector("input[data-custom]")?.value ?? "").trim();
    const selected = skip || question.multiSelect !== true && custom !== "" ? [] : field ? selectedLabels(field) : [];
    return { id: question.id, selected, ...custom === "" ? {} : { custom } };
  });
  return { type: "question", requestId: model.requestId, answer: { answers } };
}
function buildApprovalAnswer(model, outcome) {
  return { type: "approval", requestId: model.requestId, outcome };
}
function styles() {
  const card = {
    "border": "1px solid var(--dsh-border-color, rgba(128,128,128,0.35))",
    "border-radius": "10px",
    "padding": "10px 12px",
    "margin": "0 0 8px",
    "font": "inherit",
    "color": "inherit",
    "background": "var(--dsh-bg-elevated, transparent)",
    "display": "flex",
    "flex-direction": "column",
    "gap": "8px"
  };
  const title = { "font-weight": "600", "font-size": "13px", "margin": "0" };
  const muted = { "font-size": "12px", "opacity": "0.8", "margin": "0" };
  const question = { "display": "flex", "flex-direction": "column", "gap": "6px" };
  const label = { "font-size": "13px", "margin": "0" };
  const options = { "display": "flex", "flex-wrap": "wrap", "gap": "6px" };
  const button2 = {
    "font": "inherit",
    "font-size": "12px",
    "padding": "4px 10px",
    "border-radius": "999px",
    "border": "1px solid var(--dsh-border-color, rgba(128,128,128,0.35))",
    "background": "transparent",
    "color": "inherit",
    "cursor": "pointer"
  };
  const primary = { ...button2, "border-color": "transparent", "background": "var(--dsh-accent, #3b6ef5)", "color": "#fff" };
  const input = { "font": "inherit", "font-size": "12px", "padding": "4px 8px", "border-radius": "6px", "border": "1px solid var(--dsh-border-color, rgba(128,128,128,0.35))", "background": "transparent", "color": "inherit" };
  const actions = { "display": "flex", "gap": "8px", "justify-content": "flex-end" };
  return { card, title, muted, question, label, options, button: button2, primary, input, actions };
}
function apply(node, style) {
  for (const [key, value] of Object.entries(style)) node.style.setProperty(key, value);
  return node;
}
function el(tag, text, style) {
  const node = document.createElement(tag);
  if (text !== void 0) node.textContent = text;
  if (style !== void 0) apply(node, style);
  return node;
}
function button(text, style, onClick) {
  const node = el("button", text, style);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}
function toggleOption(target, multiSelect) {
  const pressed = target.getAttribute("aria-pressed") === "true";
  if (!multiSelect) {
    for (const other of target.parentElement?.querySelectorAll("button[data-option]") ?? []) other.setAttribute("aria-pressed", "false");
  }
  target.setAttribute("aria-pressed", pressed ? "false" : "true");
  for (const other of target.parentElement?.querySelectorAll("button[data-option]") ?? []) {
    apply(other, other.getAttribute("aria-pressed") === "true" ? styles().primary : styles().button);
  }
}
function mountInteractionCard(composer, model, handlers) {
  const host = composer?.parentElement;
  if (!host || model.requestId === "") return null;
  const s = styles();
  const root = document.createElement("div");
  root.setAttribute("data-dsh-remote-interaction", model.requestId);
  apply(root, s.card);
  root.appendChild(el("p", model.title, s.title));
  if (model.handedBack) {
    root.appendChild(el("p", COPY.handedBack, s.muted));
  } else if (model.kind === "approval") {
    root.appendChild(el("p", model.reason, s.label));
    if (model.toolName !== "") root.appendChild(el("p", model.toolName, s.muted));
    const actions = el("div", void 0, s.actions);
    actions.appendChild(button(COPY.reject, s.button, () => handlers.onAnswer(buildApprovalAnswer(model, "rejected"))));
    actions.appendChild(button(COPY.approve, s.primary, () => handlers.onAnswer(buildApprovalAnswer(model, "allowed-once"))));
    root.appendChild(actions);
  } else {
    for (const question of model.questions) {
      const field = el("div", void 0, s.question);
      field.setAttribute("data-question", question.id);
      if (question.header !== "") field.appendChild(el("p", question.header, s.muted));
      field.appendChild(el("p", question.question, s.label));
      if (question.detail !== "") field.appendChild(el("p", question.detail, s.muted));
      if (question.options.length > 0) {
        const options = el("div", void 0, s.options);
        for (const option of question.options) {
          const node = button(option.label, s.button, (event) => toggleOption(event.currentTarget, question.multiSelect));
          node.setAttribute("data-option", option.label);
          node.setAttribute("aria-pressed", "false");
          if (option.description !== "") node.title = option.description;
          options.appendChild(node);
        }
        field.appendChild(options);
      }
      if (question.options.length === 0 || !question.multiSelect) {
        const input = el("input", void 0, s.input);
        input.setAttribute("data-custom", "");
        input.placeholder = COPY.customPlaceholder;
        field.appendChild(input);
      }
      root.appendChild(field);
    }
    const actions = el("div", void 0, s.actions);
    actions.appendChild(button(COPY.skip, s.button, () => handlers.onAnswer(buildQuestionAnswer(model, root, true))));
    actions.appendChild(button(COPY.submit, s.primary, () => handlers.onAnswer(buildQuestionAnswer(model, root, false))));
    root.appendChild(actions);
  }
  host.insertBefore(root, host.firstChild);
  return () => {
    root.remove();
  };
}

// client/branch-banner.js
function branchBannerModel(status, conflict = null) {
  if (!status || typeof status !== "object") return null;
  if (status.kind === "mirror" && status.canTakeover === true) {
    const reason = typeof status.reason === "string" && status.reason !== "" ? status.reason : "\u8BBE\u5907\u4E0D\u53EF\u8FBE";
    return { kind: "mirror", text: `\u8BBE\u5907\u79BB\u7EBF\uFF1A${reason}\u3002\u53EF\u4EE5\u628A\u5B83\u63A5\u7BA1\u6210\u672C\u5730\u5206\u652F\uFF0C\u7528\u672C\u673A\u6A21\u578B\u7EE7\u7EED\u3002`, actions: [{ id: "takeover", label: "\u63A5\u7BA1\u4E3A\u672C\u5730\u5206\u652F" }] };
  }
  if (status.kind === "branch") {
    if (typeof status.label !== "string" || status.label === "") return null;
    const exits = Array.isArray(conflict?.exits) ? conflict.exits : [];
    if (conflict !== null && typeof conflict.message === "string" && conflict.message !== "" && exits.length > 0) {
      const labels = { "keep-local": "\u4FDD\u6301\u672C\u5730", "fork-on-device": "\u5728\u8BBE\u5907\u4E0A\u53E6\u8D77\u4E00\u6761" };
      return { kind: "branch", text: `${status.label}\u3002${conflict.message}`, actions: exits.map((id) => ({ id: id === "fork-on-device" ? "fork" : "keep", label: labels[id] ?? id })) };
    }
    const push = status.push;
    if (push?.state === "ready") return { kind: "branch", text: `${status.label}\u3002\u8BBE\u5907\u5DF2\u6062\u590D\uFF0C\u53EF\u4EE5\u628A\u5206\u652F\u91CC\u7684\u65B0\u5185\u5BB9\u56DE\u63A8\u56DE\u53BB\u3002`, actions: [{ id: "push", label: "\u56DE\u63A8\u5230\u8BBE\u5907" }] };
    if (push?.state === "offline" || push?.state === "unreachable") return { kind: "branch", text: `${status.label}\u3002\u8BBE\u5907\u79BB\u7EBF\uFF0C\u6062\u590D\u540E\u53EF\u4EE5\u56DE\u63A8\u3002`, actions: [] };
    return { kind: "branch", text: status.label, actions: [] };
  }
  return null;
}
function mountBranchBanner(composer, model, handlers) {
  const host = composer?.parentElement;
  if (!host || !model) return null;
  const root = document.createElement("div");
  root.setAttribute("data-dsh-remote-branch", model.kind);
  root.setAttribute("role", "status");
  root.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:10px",
    "flex-wrap:wrap",
    "margin:0 0 8px",
    "padding:8px 12px",
    "border-radius:10px",
    "border:1px solid var(--dsw-alias-border-secondary, #3a3a3f)",
    "font-size:12px",
    "color:var(--dsw-alias-label-secondary, #9aa4b2)"
  ].join(";");
  const text = document.createElement("span");
  text.style.cssText = "flex:1;min-width:0;";
  text.textContent = model.text;
  root.appendChild(text);
  for (const action of Array.isArray(model.actions) ? model.actions : []) {
    const button2 = document.createElement("button");
    button2.type = "button";
    button2.setAttribute("data-dsh-remote-action", action.id);
    button2.textContent = action.label;
    button2.style.cssText = [
      "font:inherit",
      "font-size:12px",
      "padding:4px 12px",
      "border-radius:8px",
      "border:1px solid var(--dsw-alias-label-primary, #e7eaf0)",
      "background:transparent",
      "color:inherit",
      "cursor:pointer"
    ].join(";");
    button2.addEventListener("click", () => handlers.onAction(action.id));
    root.appendChild(button2);
  }
  host.insertBefore(root, host.firstChild);
  return () => {
    root.remove();
  };
}
async function openSessionRow(sessionId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 6e3;
  const intervalMs = options.intervalMs ?? 400;
  const key = `session:${sessionId ?? ""}`;
  for (const deadline = Date.now() + timeoutMs; ; await new Promise((resolve) => setTimeout(resolve, intervalMs))) {
    const row = document.querySelector(`[data-row-key="${key}"]`);
    if (row) {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    }
    if (Date.now() >= deadline) return false;
  }
}

// client/remote-gate.js
var REMOTE_SESSION_ENDPOINTS = /* @__PURE__ */ new Set([
  // 发消息 / 停止 / 切模型：这是「请求到底发到哪」的关键。少了它们，镜像会话上
  // 发出的每一条消息都会落到本机，界面上却显示成功。
  "session/prompt",
  "session/cancel",
  "session/selectModel",
  "session/rename",
  "session/fork",
  "session/updateQueue",
  "session/attachment",
  "session/openWorkspacePath",
  "session/workspacePathApplications",
  "commands/execute",
  "commands/list",
  // 审批、提问、计划评审在界面上是同一张动作卡：答复走 actionCards/act；限时提问的文本回答走 userQuestions/answer。
  // 都带 agentId（即会话标识），必须在 A 上执行——决定会作为事件写进 A 的日志，镜像同步到之后各端卡片一起收起。
  "actionCards/act",
  "userQuestions/answer",
  "fileUploads/upload",
  "fileReferences/list",
  "permissionPresets/catalog",
  // 后台任务：杀掉远端任务必须发到 A 机。
  "job/kill",
  // 子代理：提示与打断都在 A 机上执行。
  "subagents/prompt",
  "subagents/interruptByParent",
  // 右侧边栏的工作区文件：读的是 A 机的磁盘。
  "workspaceFiles/list",
  "workspaceFiles/read",
  "workspaceFiles/stat",
  "workspaceFiles/readBytes",
  "workspaceFiles/search",
  // 终端：pty 必须开在 A 机上。
  "terminal/create",
  "terminal/close",
  "terminal/rename",
  "terminal/list",
  "terminal/shells",
  "terminal/environment"
]);
var REMOTE_WORKSPACE_ENDPOINTS = /* @__PURE__ */ new Set([
  "workspace/rename",
  "workspace/delete",
  "workspace/archiveSession",
  "workspace/unarchiveSession",
  "workspace/pinSession",
  "workspace/unpinSession"
]);
var USER_INITIATED = /* @__PURE__ */ new Set([
  "session/prompt",
  "session/cancel",
  "session/selectModel",
  "session/rename",
  "session/fork",
  "session/create",
  "commands/execute",
  "fileUploads/upload",
  "job/kill",
  "subagents/prompt",
  "actionCards/act",
  "userQuestions/answer",
  "terminal/create"
]);
var SESSION_SHARE_MENU_ENABLED = false;
var REMOTE_STREAMS_ENABLED = true;
var CREATE_REFUSAL = "\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u662F\u53EA\u8BFB\u7684\uFF1A\u65B0\u5EFA\u4F1A\u8BDD\u8BF7\u5728\u8BBE\u5907\u672C\u673A\u4E0A\u64CD\u4F5C";
var LOCAL_VIEW_ENDPOINTS = /* @__PURE__ */ new Set([
  "session/state",
  "session/wait",
  "session/page",
  "session/events",
  "session/projections",
  "session/observeEvent",
  "session/observeProjections",
  "session/observeState",
  "session/follow"
]);
var TERMINAL_ENDPOINTS = /* @__PURE__ */ new Set([
  "terminal/create",
  "terminal/close",
  "terminal/rename",
  "terminal/list",
  "terminal/shells",
  "terminal/environment"
]);
var TERMINAL_REFUSAL = "\u8FDC\u7A0B\u4F1A\u8BDD\u7684\u7EC8\u7AEF\u8981\u7B49\u6D41\u5F0F\u901A\u9053\u63A5\u901A\u540E\u624D\u80FD\u7528\uFF0C\u8BF7\u5148\u5728\u8BBE\u5907\u672C\u673A\u4E0A\u6253\u5F00";
function requestOf(args) {
  const request = args && args.request;
  return request !== null && typeof request === "object" ? request : {};
}
function explicitSessionIdOf(args) {
  const request = requestOf(args);
  const address = request && typeof request.address === "object" && request.address !== null ? request.address : {};
  const candidates = [
    args && args.agentId,
    args && args.sessionId,
    args && args.workspaceFileScopeId,
    args && args.parentSessionId,
    args && args.childSessionId,
    request.sessionId,
    request.parentSessionId,
    address.sessionId
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}
function remoteSessionIdIn(args, sessions) {
  if (!(sessions instanceof Set) || sessions.size === 0) return null;
  const explicit = explicitSessionIdOf(args);
  if (explicit !== "" && sessions.has(explicit)) return explicit;
  let text = "";
  try {
    text = JSON.stringify(args);
  } catch {
    text = "";
  }
  if (text === "") return null;
  for (const id of sessions) {
    if (text.includes(id)) return id;
  }
  return null;
}
function workspaceIdOf(args) {
  const request = requestOf(args);
  if (typeof (args && args.workspaceId) === "string" && args.workspaceId !== "") return args.workspaceId;
  if (typeof request.workspaceId === "string" && request.workspaceId !== "") return request.workspaceId;
  return "";
}
function decideRemoteCall(endpoint, args, known, flags = {}) {
  const writesEnabled = typeof flags.writesEnabled === "boolean" ? flags.writesEnabled : REMOTE_WRITES_ENABLED;
  const streamsEnabled = typeof flags.streamsEnabled === "boolean" ? flags.streamsEnabled : REMOTE_STREAMS_ENABLED;
  const sessions = known && known.sessions;
  const workspaces = known && known.workspaces;
  const workspacePaths = known && known.workspacePaths;
  const slash = endpoint.indexOf("/");
  const namespace = endpoint.slice(0, slash);
  const method = endpoint.slice(slash + 1);
  if (endpoint === "session/create") {
    const request = requestOf(args);
    const cwd = typeof request.cwd === "string" ? request.cwd : "";
    const workspaceId = workspaceIdOf(args);
    const remoteOnly = known && known.remoteOnlyWorkspaces;
    const byId = remoteOnly instanceof Set ? workspaceId !== "" && remoteOnly.has(workspaceId) : workspaces instanceof Set && workspaceId !== "" && workspaces.has(workspaceId);
    const remote = byId || workspacePaths instanceof Set && cwd !== "" && workspacePaths.has(cwd);
    if (!remote) return { kind: "pass" };
    if (flags.remoteOffline === true) {
      return { kind: "refuse", message: flags.remoteOfflineReason || "\u8FDE\u4E0D\u4E0A\u8BBE\u5907\uFF0C\u53EF\u91CD\u8BD5", notify: true };
    }
    if (writesEnabled) return { kind: "forward-create" };
    return { kind: "refuse", message: CREATE_REFUSAL, notify: true };
  }
  if (REMOTE_SESSION_ENDPOINTS.has(endpoint)) {
    if (remoteSessionIdIn(args, sessions) === null) return { kind: "pass" };
    if (TERMINAL_ENDPOINTS.has(endpoint) && !streamsEnabled) {
      return { kind: "refuse", message: TERMINAL_REFUSAL, notify: USER_INITIATED.has(endpoint) };
    }
    if (decideRemoteInvoke(namespace, method, writesEnabled) === "allow") return { kind: "forward", namespace, method };
    return { kind: "refuse", message: remoteReadonlyRefusal(endpoint), notify: USER_INITIATED.has(endpoint) };
  }
  if (REMOTE_WORKSPACE_ENDPOINTS.has(endpoint)) {
    const workspaceId = workspaceIdOf(args);
    if (!(workspaces instanceof Set) || workspaceId === "" || !workspaces.has(workspaceId)) return { kind: "pass" };
    return { kind: endpoint === "workspace/delete" ? "local-remove" : "local" };
  }
  if (remoteSessionIdIn(args, sessions) !== null && !LOCAL_VIEW_ENDPOINTS.has(endpoint)) {
    if (decideRemoteInvoke(namespace, method, writesEnabled) === "allow") return { kind: "forward", namespace, method };
    return { kind: "refuse", message: remoteReadonlyRefusal(endpoint), notify: USER_INITIATED.has(endpoint) };
  }
  return { kind: "pass" };
}

// client/client.source.jsx
var import_jsx_runtime6 = require("react/jsx-runtime");
var inject = [
  "slots",
  "connection",
  "locale",
  "remote",
  // 会话级转发要用的远端命名空间：Cordis Guard 对嵌套属性同样要求声明。
  "remote.session",
  "remote.commands",
  "remote.fileUploads",
  "remote.fileReferences",
  "remote.permissionPresets"
];
function apply2(ctx) {
  const t = installRemoteAccessCopy(ctx);
  const rpc = ctx?.connection?.rpc;
  if (rpc && typeof rpc.call === "function") {
    hostRpc = (channel, endpoint, payload) => rpc.call(channel, endpoint, payload);
  } else {
    ctx?.logger?.warn?.(
      "dsh-remote-access: connection.rpc \u4E0D\u53EF\u7528\uFF0C\u8FDC\u7A0B\u8BBF\u95EE\u9762\u677F\u65E0\u6CD5\u4E0E host \u901A\u4FE1"
    );
  }
  const slots = ctx?.slots;
  if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") {
    ctx?.logger?.warn?.("dsh-remote-access: slots \u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u8DF3\u8FC7\u8BBE\u7F6E\u5165\u53E3");
    return;
  }
  slots.inject(
    "settings.section",
    () => slots.register(
      {
        name: "settings.section",
        id: "dsh-remote-devices",
        order: 20,
        label: () => t("\u8FDC\u7A0B\u8BBE\u5907\u7BA1\u7406")
      },
      () => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RemoteAccessI18nProvider, { t, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RemoteDevicesSection, { hostCall }) })
    )
  );
  if (SESSION_SHARE_MENU_ENABLED) slots.inject(
    "sidebar.workspaces.session.menu.item",
    () => slots.register(
      { name: "sidebar.workspaces.session.menu.item", id: "dsh-remote-sync", order: 900 },
      (menuProps) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RemoteAccessI18nProvider, { t, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        RemoteSyncMenu,
        {
          sessionId: menuProps.sessionId,
          hostCall,
          dismiss: () => menuProps.menuOpenState?.[1]?.(false)
        }
      ) })
    )
  );
  const pick = () => {
    const desktop = globalThis.__DSH_DIRECTORY_PICKER__;
    if (desktop && typeof desktop.pick === "function") return desktop.pick();
    const uiWorkspace = ctx.get?.("uiWorkspace");
    return uiWorkspace?.pickDirectory?.() ?? Promise.resolve(null);
  };
  const flowInjected = () => ({ hostCall, pick });
  for (const hole of ["sidebar.workspaces.directoryFlow", "conversation.hero.workspace.directoryFlow"]) {
    slots.inject(
      hole,
      () => slots.register({ name: hole, priority: -1, inject: flowInjected }, (flowProps) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RemoteAccessI18nProvider, { t, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RemoteDirectoryFlow, { ...flowProps }) }))
    );
  }
  const primeRemoteSets = async () => {
    try {
      const state = await hostCall("remoteWorkspace.list");
      const list = Array.isArray(state?.workspaces) ? state.workspaces : [];
      const sessions = /* @__PURE__ */ new Set();
      const workspacePaths = /* @__PURE__ */ new Set();
      const workspaces = /* @__PURE__ */ new Set();
      const remoteOnly = /* @__PURE__ */ new Set();
      for (const workspace of list) {
        const shared = workspace?.localDirectory === true || workspace?.claimed === true;
        if (typeof workspace?.id === "string" && workspace.id !== "") {
          workspaces.add(workspace.id);
          if (!shared) remoteOnly.add(workspace.id);
        }
        if (typeof workspace?.path === "string" && workspace.path !== "" && workspace.claimed !== true && !shared) workspacePaths.add(workspace.path);
        for (const sessionId of workspace?.sessionIds ?? []) {
          if (typeof sessionId === "string" && sessionId !== "") sessions.add(sessionId);
        }
      }
      globalThis.__DSH_REMOTE_SESSIONS__ = sessions;
      globalThis.__DSH_REMOTE_WORKSPACES__ = workspaces;
      globalThis.__DSH_REMOTE_ONLY_WORKSPACES__ = remoteOnly;
      globalThis.__DSH_REMOTE_WORKSPACE_PATHS__ = workspacePaths;
    } catch {
    }
  };
  void primeRemoteSets();
  try {
    const uninstallBadge = installRemoteWorkspaceBadge({ hostCall });
    ctx?.on?.("dispose", uninstallBadge);
  } catch (error) {
    ctx?.logger?.warn?.(`dsh-remote-access: \u8FDC\u7A0B\u5DE5\u4F5C\u533A\u5FBD\u6807\u672A\u5B89\u88C5\uFF08${String(error)}\uFF09`);
  }
  try {
    const uninstallSourceFilter = installSidebarSourceFilter({ hostCall });
    ctx?.on?.("dispose", uninstallSourceFilter);
  } catch (error) {
    ctx?.logger?.warn?.(`dsh-remote-access: \u4FA7\u680F\u6765\u6E90\u5207\u6362\u672A\u5B89\u88C5\uFF08${String(error)}\uFF09`);
  }
  try {
    const uninstallPeerApprovals = installPeerApprovals({ hostCall, toast: showRemoteToast });
    ctx?.on?.("dispose", uninstallPeerApprovals);
  } catch (error) {
    ctx?.logger?.warn?.(`dsh-remote-access: \u914D\u5BF9\u5BA1\u6279\u5361\u672A\u5B89\u88C5\uFF08${String(error)}\uFF09`);
  }
  const installForwarding = () => {
    try {
      const remote = ctx?.remote;
      if (remote) {
        const forward = async (namespace, method, args) => {
          const result = await hostCall("remoteSession.invoke", { namespace, method, args });
          return result && result.value !== void 0 ? result.value : void 0;
        };
        const wrap = (name, table) => {
          const ns = remote[name];
          if (!ns) return;
          const wrapped = Object.create(ns);
          for (const [method, toArgs] of Object.entries(table)) {
            if (typeof ns[method] !== "function") continue;
            if (decideRemoteInvoke(name, method) === "refuse") continue;
            const original = ns[method].bind(ns);
            wrapped[method] = async (...args) => {
              try {
                const value = await forward(name, method, toArgs(args));
                if (value !== void 0) {
                  if (value && value.queued === true) return { commandId: "queued", result: { kind: "success" } };
                  return value;
                }
              } catch (error) {
                const message = String(error?.message ?? error);
                const missing = message.includes("not-found") || message.includes("not found");
                if (!missing) {
                  console.warn("dsh-remote-access: \u8FDC\u7A0B\u8C03\u7528\u5931\u8D25\uFF0C\u5DF2\u5FFD\u7565\u672C\u5730\u56DE\u9000\uFF1A" + message);
                  return { commandId: "remote-failed", result: { kind: "success" } };
                }
              }
              return original(...args);
            };
          }
          Object.defineProperty(remote, name, { value: wrapped, configurable: true, writable: true });
        };
        const request = (args) => ({ request: args[0] });
        wrap("session", {
          rename: request,
          fork: request,
          updateQueue: request,
          attachment: request,
          openWorkspacePath: request,
          workspacePathApplications: request
        });
        wrap("commands", {
          execute: (args) => ({ agentId: args[0], line: args[1], submittedAttachments: args[2] ?? [] }),
          list: (args) => ({ agentId: args[0] })
        });
        wrap("fileUploads", {
          upload: (args) => ({ agentId: args[0], request: args[1] })
        });
        wrap("fileReferences", {
          list: (args) => ({ agentId: args[0], query: args[1] ?? "" })
        });
        wrap("permissionPresets", {
          catalog: () => ({})
        });
        ctx?.logger?.info?.("dsh-remote-access: \u4F1A\u8BDD\u7EA7\u8F6C\u53D1\u5DF2\u5B89\u88C5\uFF08session/commands/fileUploads/fileReferences/permissionPresets\uFF09");
      }
    } catch (error) {
      ctx?.logger?.warn?.(`dsh-remote-access: \u4F1A\u8BDD\u7EA7\u8F6C\u53D1\u672A\u5B89\u88C5\uFF08${String(error)}\uFF09`);
    }
  };
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    const ready = ctx?.remote && ctx.remote.session && ctx.remote.commands;
    if (ready) {
      clearInterval(timer);
      installForwarding();
      return;
    }
    if (tries >= 60) clearInterval(timer);
  }, 500);
  ctx?.on?.("dispose", () => clearInterval(timer));
  try {
    const rpcService = ctx?.connection?.rpc;
    if (rpcService && typeof rpcService.call === "function") {
      const originalCall = rpcService.call.bind(rpcService);
      const promptTextOf = (args) => {
        const request = args && args.request ? args.request : {};
        const content = Array.isArray(request.content) ? request.content : [];
        return content.filter((part) => part && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("");
      };
      const knownRemote = () => ({
        sessions: globalThis.__DSH_REMOTE_SESSIONS__,
        workspaces: globalThis.__DSH_REMOTE_WORKSPACES__,
        workspacePaths: globalThis.__DSH_REMOTE_WORKSPACE_PATHS__,
        remoteOnlyWorkspaces: globalThis.__DSH_REMOTE_ONLY_WORKSPACES__
      });
      const remoteFlags = (endpoint, args) => {
        if (endpoint !== "session/create") return {};
        const request = args && args.request ? args.request : {};
        const link = typeof globalThis.__DSH_REMOTE_LINK__ === "function" ? globalThis.__DSH_REMOTE_LINK__({ workspaceId: workspaceIdOf(args), path: typeof request.cwd === "string" ? request.cwd : "" }) : null;
        return link && link.state !== "online" ? { remoteOffline: true, remoteOfflineReason: link.reason } : {};
      };
      let inside = false;
      rpcService.call = async (channel, endpoint, payload, signal) => {
        if (inside || channel !== "/api") return originalCall(channel, endpoint, payload, signal);
        const args = payload && payload.args ? payload.args : {};
        const verdict = decideRemoteCall(endpoint, args, knownRemote(), remoteFlags(endpoint, args));
        if (verdict.kind === "pass" || verdict.kind === "local") {
          return originalCall(channel, endpoint, payload, signal);
        }
        if (verdict.kind === "local-remove") {
          const result = await originalCall(channel, endpoint, payload, signal);
          if (result && result.ok !== false) {
            inside = true;
            try {
              await hostCall("remoteWorkspace.remove", { workspaceId: workspaceIdOf(args) });
            } catch {
            } finally {
              inside = false;
            }
          }
          return result;
        }
        if (verdict.kind === "refuse") {
          if (verdict.notify) showRemoteToast(verdict.message);
          if (endpoint === "session/prompt") restoreComposer(promptTextOf(args));
          return { ok: false, error: { code: "remote-readonly", message: verdict.message } };
        }
        inside = true;
        try {
          if (verdict.kind === "forward-create") {
            const request = args && args.request ? args.request : {};
            const created = await hostCall("remoteSession.create", { path: request.cwd ?? "", workspaceId: typeof request.workspaceId === "string" ? request.workspaceId : "" });
            if (created && typeof created.sessionId === "string") {
              return { ok: true, value: { sessionId: created.sessionId, agentPreset: "standard" } };
            }
          } else {
            const result = await hostCall("remoteSession.invoke", { namespace: verdict.namespace, method: verdict.method, args });
            if (result && result.value !== void 0) return { ok: true, value: result.value };
          }
        } catch (error) {
          const message = String(error?.message ?? error);
          console.warn("dsh-remote-access: \u8FDC\u7A0B\u8C03\u7528\u5931\u8D25 " + endpoint + "\uFF1A" + message);
          if (message.includes("not-remote-workspace")) {
            inside = false;
            return originalCall(channel, endpoint, payload, signal);
          }
          if (endpoint === "session/create") showRemoteToast("\u8FDC\u7A0B\u8BBE\u5907\u672A\u8FDE\u63A5\uFF1A" + message);
          if (endpoint === "session/prompt") restoreComposer(promptTextOf(args));
          return { ok: false, error: { code: "remote-failed", message } };
        } finally {
          inside = false;
        }
        return originalCall(channel, endpoint, payload, signal);
      };
      console.info("dsh-remote-access: \u4F20\u8F93\u5C42\u8F6C\u53D1\u5DF2\u5B89\u88C5");
      const pickSession = (args) => {
        const request = args && args.request ? args.request : {};
        const candidates = [args && args.agentId, args && args.sessionId, args && args.workspaceFileScopeId, request.sessionId, request.parentSessionId];
        for (const value of candidates) if (typeof value === "string" && value !== "") return value;
        return void 0;
      };
      const openRemoteStream = (endpoint, args, sessionId, signal, uplink) => {
        const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/remote-access.stream?sessionId=" + encodeURIComponent(sessionId);
        const socket = new WebSocket(url);
        const streamId = "rs-" + Math.random().toString(36).slice(2);
        const queue = [];
        let finished = false;
        let wake = null;
        const push = (frame) => {
          queue.push(frame);
          if (wake) {
            const w = wake;
            wake = null;
            w();
          }
        };
        socket.addEventListener("message", (event) => {
          let message;
          try {
            message = JSON.parse(event.data);
          } catch {
            return;
          }
          if (message.streamId !== streamId) return;
          if (message.type === "item") push({ kind: "item", value: message.value });
          else if (message.type === "error") {
            push({ kind: "error", error: message.error });
            finished = true;
          } else if (message.type === "end") {
            push({ kind: "end" });
            finished = true;
          }
        });
        socket.addEventListener("close", () => {
          finished = true;
          if (wake) {
            const w = wake;
            wake = null;
            w();
          }
        });
        const ready = new Promise((resolve) => {
          socket.addEventListener("open", () => {
            socket.send(JSON.stringify({ type: "open", streamId, endpoint, payload: { args } }));
            resolve();
          });
          socket.addEventListener("error", () => resolve());
        });
        if (uplink) {
          void (async () => {
            try {
              for await (const value of uplink) {
                await ready;
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "item", streamId, value }));
              }
              await ready;
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "end", streamId }));
            } catch {
            }
          })();
        }
        const abort = () => {
          finished = true;
          if (wake) {
            const w = wake;
            wake = null;
            w();
          }
        };
        if (signal) signal.addEventListener("abort", abort);
        return (async function* relay() {
          try {
            await ready;
            while (true) {
              if (queue.length === 0) {
                if (finished) return;
                await new Promise((resolve) => {
                  wake = resolve;
                });
                continue;
              }
              const frame = queue.shift();
              if (frame.kind === "item") {
                yield frame.value;
                continue;
              }
              if (frame.kind === "error") throw new Error(frame.error && frame.error.message || endpoint + " \u8FDC\u7AEF\u6D41\u5931\u8D25");
              return;
            }
          } finally {
            if (signal) signal.removeEventListener("abort", abort);
            try {
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel", streamId }));
            } catch {
            }
            try {
              socket.close();
            } catch {
            }
          }
        })();
      };
      rpcService.open = (channel, endpoint, payload, signal, uplink) => {
        if (!REMOTE_STREAMS_ENABLED) return void 0;
        if (channel !== "/api" || LOCAL_VIEW_ENDPOINTS.has(endpoint)) return void 0;
        const args = payload && payload.args ? payload.args : {};
        const sessionId = pickSession(args);
        const known = globalThis.__DSH_REMOTE_SESSIONS__;
        if (!(known instanceof Set) || !known.has(sessionId)) return void 0;
        return openRemoteStream(endpoint, args, sessionId, signal, uplink);
      };
      console.info("dsh-remote-access: \u6D41\u5F0F\u8F6C\u53D1\u5DF2\u5B89\u88C5");
    }
  } catch (error) {
    ctx?.logger?.warn?.(`dsh-remote-access: \u4F20\u8F93\u5C42\u8F6C\u53D1\u672A\u5B89\u88C5\uFF08${String(error)}\uFF09`);
  }
  let interactionCard = null;
  let interactionShown = "";
  let interactionBusy = false;
  const openSessionId = () => {
    const row = document.querySelector('[data-row-key^="session:"][aria-selected="true"]');
    const key = row ? row.getAttribute("data-row-key") || "" : "";
    return key.startsWith("session:") ? key.slice("session:".length) : "";
  };
  const dismissInteractionCard = () => {
    if (interactionCard !== null) {
      interactionCard();
      interactionCard = null;
    }
    interactionShown = "";
  };
  const interactionTick = async () => {
    if (interactionBusy) return;
    const sessionId = openSessionId();
    const sessions = globalThis.__DSH_REMOTE_SESSIONS__;
    if (sessionId === "" || !(sessions instanceof Set) || !sessions.has(sessionId)) {
      dismissInteractionCard();
      return;
    }
    let pending;
    try {
      pending = await hostCall("remoteInteraction.pending", { sessionId });
    } catch {
      return;
    }
    const interaction = cardForSession(pending?.interactions, sessionId);
    const key = interaction ? `${interaction.requestId}:${interaction.handedBack ? "back" : "open"}` : "";
    if (key === interactionShown) return;
    dismissInteractionCard();
    if (interaction === null) return;
    const composer = document.querySelector('[contenteditable="true"][role="textbox"]') ?? document.querySelector("textarea");
    const mounted = mountInteractionCard(composer, cardModel(interaction), {
      onAnswer: async (answer) => {
        interactionBusy = true;
        try {
          const result = await hostCall("remoteInteraction.answer", { answer });
          if (result?.accepted === true) dismissInteractionCard();
          else showRemoteToast("\u8FD9\u6B21\u56DE\u7B54\u6CA1\u6709\u88AB\u6536\u4E0B\uFF1A\u8BBE\u5907\u672C\u673A\u5DF2\u7ECF\u5904\u7406\u4E86\u8FD9\u4E00\u9879");
        } catch (error) {
          showRemoteToast(`\u56DE\u7B54\u6CA1\u80FD\u9001\u5230\u8BBE\u5907\u672C\u673A\uFF1A${String(error?.message ?? error)}`);
        } finally {
          interactionBusy = false;
        }
      }
    });
    if (mounted !== null) {
      interactionCard = mounted;
      interactionShown = key;
    }
  };
  setInterval(() => {
    void interactionTick();
  }, 1500);
  let branchBanner = null;
  let branchShown = "";
  let branchBusy = false;
  let branchIdsSeen = "";
  const dismissBranchBanner = () => {
    if (branchBanner !== null) {
      branchBanner();
      branchBanner = null;
    }
    branchShown = "";
  };
  const branchConflicts = {};
  const branchAct = async (sessionId, action) => {
    const redraw = () => {
      branchShown = "";
      void branchTick();
    };
    try {
      if (action === "takeover") {
        const result = await hostCall("remoteSession.takeover", { sessionId });
        showRemoteToast(`\u5DF2\u63A5\u7BA1\u4E3A\u672C\u5730\u5206\u652F\uFF1A${result?.label ?? ""}`);
        dismissBranchBanner();
        const opened = await openSessionRow(result?.branch?.sessionId ?? "");
        if (!opened) showRemoteToast("\u5206\u652F\u5DF2\u5EFA\u597D\uFF0C\u5728\u4FA7\u680F\u91CC\u6253\u5F00\u5B83\u5373\u53EF\u7EE7\u7EED");
        return;
      }
      if (action === "push") {
        const result = await hostCall("remoteBranch.push", { sessionId });
        if (result?.ok === true) {
          delete branchConflicts[sessionId];
          showRemoteToast(`\u5DF2\u56DE\u63A8\u5230\u8BBE\u5907\uFF1A${String(result.appended ?? "")} \u6761\u65B0\u5185\u5BB9\uFF0C\u5DF2\u56DE\u5230\u8FDC\u7A0B\u4F1A\u8BDD`);
          await openSessionRow(result?.mirrorSessionId ?? "");
        } else if ((result?.exits ?? []).length > 0) {
          branchConflicts[sessionId] = { message: result.message ?? "\u8BBE\u5907\u6CA1\u6709\u6536\u4E0B\u8FD9\u6B21\u56DE\u63A8", exits: result.exits };
          showRemoteToast(result.message ?? "\u8BBE\u5907\u6CA1\u6709\u6536\u4E0B\u8FD9\u6B21\u56DE\u63A8");
        } else {
          showRemoteToast(result?.message ?? "\u8BBE\u5907\u6CA1\u6709\u6536\u4E0B\u8FD9\u6B21\u56DE\u63A8");
        }
        return;
      }
      if (action === "keep") {
        await hostCall("remoteBranch.keep", { sessionId });
        delete branchConflicts[sessionId];
        showRemoteToast("\u5DF2\u4FDD\u6301\u672C\u5730\uFF0C\u4E0D\u518D\u63D0\u793A\u56DE\u63A8");
        return;
      }
      if (action === "fork") {
        const result = await hostCall("remoteBranch.fork", { sessionId });
        if (result?.ok !== true) {
          showRemoteToast(result?.message ?? "\u6CA1\u80FD\u5728\u8BBE\u5907\u4E0A\u53E6\u8D77\u4E00\u6761");
          return;
        }
        delete branchConflicts[sessionId];
        showRemoteToast("\u5DF2\u5728\u8BBE\u5907\u4E0A\u53E6\u8D77\u4E00\u6761\uFF0C\u5E76\u56DE\u5230\u8FDC\u7A0B\u4F1A\u8BDD");
        await openSessionRow(result?.mirrorSessionId ?? "");
      }
    } catch (error) {
      showRemoteToast(`\u8FD9\u4E00\u6B65\u6CA1\u6709\u6210\u529F\uFF1A${String(error?.message ?? error)}`);
    } finally {
      redraw();
    }
  };
  const branchTick = async () => {
    if (branchBusy) return;
    branchBusy = true;
    try {
      let branches = [];
      try {
        const state = await hostCall("remoteBranch.list");
        branches = Array.isArray(state?.branches) ? state.branches : [];
      } catch {
        branches = [];
      }
      const ids = branches.map((branch) => branch.sessionId).join(",");
      if (ids !== branchIdsSeen) {
        branchIdsSeen = ids;
        globalThis.__DSH_REMOTE_BRANCHES__ = new Map(branches.map((branch) => [branch.sessionId, `\u6765\u81EA ${branch.hostName} / ${branch.title}`]));
        try {
          globalThis.__DSH_REMOTE_BADGE_REFRESH__?.();
        } catch {
        }
      }
      const sessionId = openSessionId();
      if (sessionId === "") {
        dismissBranchBanner();
        return;
      }
      let status;
      try {
        status = await hostCall("remoteBranch.status", { sessionId });
      } catch {
        return;
      }
      const model = branchBannerModel(status, branchConflicts[sessionId] ?? null);
      const key = model ? `${model.kind}:${model.text}:${model.actions.map((item) => item.id).join(",")}` : "";
      if (key === branchShown) return;
      dismissBranchBanner();
      if (model === null) return;
      const composer = document.querySelector('[contenteditable="true"][role="textbox"]') ?? document.querySelector("textarea");
      const mounted = mountBranchBanner(composer, model, {
        onAction: (action) => {
          void branchAct(sessionId, action);
        }
      });
      if (mounted !== null) {
        branchBanner = mounted;
        branchShown = key;
      }
    } finally {
      branchBusy = false;
    }
  };
  setInterval(() => {
    void branchTick();
  }, 3e3);
}
var hostRpc = null;
async function hostCall(endpoint, payload = {}) {
  if (!hostRpc) throw new Error("host \u901A\u9053\u4E0D\u53EF\u7528\uFF08connection.rpc \u7F3A\u5931\uFF09");
  const r = await hostRpc("/api", "remote-access." + endpoint, payload);
  if (!r || !r.ok) throw new Error(r?.error?.message ?? "rpc-error");
  return r.value;
}
function readCssVar(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
var BUTTON_CSS = `
[data-remote-access-btn] {
transition: transform .08s ease, filter .15s ease, background .15s ease, border-color .15s ease, color .15s ease;
user-select: none;
}
[data-remote-access-btn]:hover { filter: brightness(1.18); }
[data-remote-access-btn]:active {
transform: translateY(1px) scale(0.97);
filter: brightness(0.92);
}
[data-remote-access-btn][data-busy="1"] {
opacity: 0.55;
cursor: progress;
}
[data-remote-access-btn][data-flash="ok"] {
background: #2fbf71 !important;
border-color: #2fbf71 !important;
color: #fff !important;
}
[data-remote-access-btn][data-flash="err"] {
background: #e5484d !important;
border-color: #e5484d !important;
color: #fff !important;
}
`;
function PanelButton({ text, ghost, cssVars, onClick }) {
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const [flash, setFlash] = (0, import_react6.useState)(null);
  const [flashText, setFlashText] = (0, import_react6.useState)(null);
  const flashTimerRef = (0, import_react6.useRef)(null);
  (0, import_react6.useEffect)(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    []
  );
  const handleClick = async () => {
    if (busy || !onClick) return;
    setBusy(true);
    try {
      await onClick({
        flash: (kind, newText, ms = 1500) => {
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          if (newText != null) setFlashText(newText);
          setFlash(kind);
          flashTimerRef.current = setTimeout(() => {
            setFlash(null);
            setFlashText(null);
            flashTimerRef.current = null;
          }, ms);
        }
      });
    } finally {
      setBusy(false);
    }
  };
  const style = {
    background: ghost ? "transparent" : cssVars.accent,
    color: ghost ? cssVars.text2 : "#fff",
    border: `1px solid ${ghost ? cssVars.line : "transparent"}`,
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer"
  };
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
    "button",
    {
      type: "button",
      "data-remote-access-btn": "1",
      "data-busy": busy ? "1" : void 0,
      "data-flash": flash ?? void 0,
      style,
      onClick: handleClick,
      children: flashText ?? text
    }
  );
}
function makeQr(link) {
  if (!link) return null;
  try {
    const qr = qrcode_default(0, "M");
    qr.addData(link);
    qr.make();
    return qr.createDataURL(4, 8);
  } catch {
    return null;
  }
}
function ChannelCard({
  label,
  desc,
  cssVars,
  beforeLink,
  link,
  qrSrc,
  hint,
  actions
}) {
  const t = useRemoteAccessT();
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
    "div",
    {
      style: {
        border: `1px solid ${cssVars.line}`,
        borderRadius: 10,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { fontSize: 13, fontWeight: 600 }, children: label }),
        desc && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { color: cssVars.text2, fontSize: 12 }, children: desc }),
        beforeLink,
        link && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "code",
          {
            style: {
              color: cssVars.text,
              fontSize: 12,
              wordBreak: "break-all",
              background: cssVars.panel,
              border: `1px solid ${cssVars.line}`,
              borderRadius: 6,
              padding: 6,
              display: "block"
            },
            children: link
          }
        ),
        qrSrc && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "img",
          {
            alt: t("{label} \u914D\u5BF9\u4E8C\u7EF4\u7801", { label }),
            src: qrSrc,
            style: {
              width: 180,
              height: 180,
              imageRendering: "pixelated",
              borderRadius: 8,
              border: `1px solid ${cssVars.line}`
            }
          }
        ),
        hint?.text && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { color: hint.color, fontSize: 12 }, children: hint.text }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: actions })
      ]
    }
  );
}
function RemoteAccessPanel() {
  const t = useRemoteAccessT();
  const cssVars = (0, import_react6.useMemo)(
    () => ({
      text: readCssVar("--dsw-alias-label-primary", "#e7eaf0"),
      text2: readCssVar("--dsw-alias-label-secondary", "#9aa4b2"),
      panel: readCssVar("--dsw-alias-bg-layer-1", "#171a21"),
      line: readCssVar("--dsw-alias-border-l2", "#2a2f3a"),
      accent: readCssVar("--dsw-alias-state-accent-primary", "#4d6bfe")
    }),
    []
  );
  (0, import_react6.useEffect)(() => {
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-remote-access", "1");
    styleEl.textContent = BUTTON_CSS;
    document.head.appendChild(styleEl);
    return () => {
      styleEl.remove();
    };
  }, []);
  const lanBaseRef = (0, import_react6.useRef)(null);
  const [lanePort, setLanePort] = (0, import_react6.useState)(null);
  const [lanLink, setLanLink] = (0, import_react6.useState)(null);
  const [lanHint, setLanHint] = (0, import_react6.useState)(null);
  const [tunInputValue, setTunInputValue] = (0, import_react6.useState)("");
  const [tunSavedUrl, setTunSavedUrl] = (0, import_react6.useState)("");
  const [tunResult, setTunResult] = (0, import_react6.useState)({ text: "", color: "" });
  const [tunLink, setTunLink] = (0, import_react6.useState)(null);
  const [tunHint, setTunHint] = (0, import_react6.useState)(null);
  const [cfState, setCfState] = (0, import_react6.useState)({
    bin: "",
    url: null,
    running: false,
    reason: null,
    phase: "idle",
    detail: "",
    message: ""
  });
  const [cfInputValue, setCfInputValue] = (0, import_react6.useState)("");
  const [cfInFlight, setCfInFlight] = (0, import_react6.useState)(null);
  const [cfStatusError, setCfStatusError] = (0, import_react6.useState)(null);
  const [cfLink, setCfLink] = (0, import_react6.useState)(null);
  const [cfHint, setCfHint] = (0, import_react6.useState)(null);
  const [devices, setDevices] = (0, import_react6.useState)([]);
  const [devicesError, setDevicesError] = (0, import_react6.useState)(null);
  const [deviceErrors, setDeviceErrors] = (0, import_react6.useState)({});
  const tunSavedUrlRef = (0, import_react6.useRef)("");
  tunSavedUrlRef.current = tunSavedUrl;
  const refreshDevices = (0, import_react6.useCallback)(async () => {
    try {
      const st = await hostCall("devices.list");
      setDevices(st.devices ?? []);
      setDevicesError(null);
      setDeviceErrors({});
    } catch (e) {
      setDevices([]);
      setDevicesError(t("\u914D\u5BF9\u670D\u52A1\u4E0D\u53EF\u8FBE\uFF1A{message}", { message: e.message }));
    }
  }, []);
  const refreshCf = (0, import_react6.useCallback)(async () => {
    try {
      const st = await hostCall("cloudflared.get");
      setCfState({
        bin: st.bin ?? "",
        url: st.url ?? null,
        running: !!st.running,
        reason: st.reason ?? null,
        message: st.message,
        phase: st.phase ?? "idle",
        detail: st.detail ?? ""
      });
      setCfStatusError(null);
    } catch (e) {
      setCfStatusError(t("\u67E5\u8BE2\u5931\u8D25\uFF1A{message}", { message: e.message }));
    }
  }, []);
  const refreshLanBase = (0, import_react6.useCallback)(async () => {
    try {
      const info = await hostCall("info");
      const port = info.lanePort;
      setLanePort(port);
      const candidates = Array.isArray(info.baseCandidates) ? info.baseCandidates : [];
      lanBaseRef.current = {
        base: info.lanIp ? info.lanIp + ":" + port : "127.0.0.1:" + port,
        candidates,
        scheme: "http"
      };
      if (!tunSavedUrlRef.current && info.customTunnelUrl) {
        setTunSavedUrl(info.customTunnelUrl);
        setTunInputValue(info.customTunnelUrl);
      }
    } catch {
    }
  }, []);
  (0, import_react6.useEffect)(() => {
    void refreshDevices();
    void refreshCf();
    void refreshLanBase();
    const id = setInterval(() => {
      void refreshDevices();
      void refreshCf();
    }, 2e3);
    return () => clearInterval(id);
  }, [refreshDevices, refreshCf, refreshLanBase]);
  (0, import_react6.useEffect)(() => {
    setCfInputValue(cfState.bin || "");
  }, [cfState.bin]);
  const cfStatus = (0, import_react6.useMemo)(() => {
    if (cfInFlight) return cfInFlight;
    if (cfStatusError) return { text: cfStatusError, color: "#e5484d" };
    const s = cfState;
    if (s.running || s.url) {
      return {
        text: s.url ? t("\u8FD0\u884C\u4E2D \xB7 {url}", { url: s.url }) : s.detail || t("\u8FD0\u884C\u4E2D \xB7 \u7B49\u5F85\u96A7\u9053\u5730\u5740\u2026"),
        color: "#2fbf71"
      };
    }
    if (s.phase === "error") {
      return {
        text: t("\u542F\u52A8\u5931\u8D25\uFF1A{message}", { message: s.message || s.detail || t("cloudflared \u65E0\u6CD5\u542F\u52A8") }),
        color: "#e5484d"
      };
    }
    if (s.phase === "resolving" || s.phase === "downloading") {
      return {
        text: s.phase === "downloading" ? t("\u4E0B\u8F7D\u4E2D \xB7 {detail}", { detail: s.detail || "\u2026" }) : t("\u89E3\u6790\u4E2D \xB7 {detail}", { detail: s.detail || "\u2026" }),
        color: "#4d6bfe"
      };
    }
    if (s.phase === "starting" || s.phase === "registering") {
      return { text: s.detail || t("\u542F\u52A8\u4E2D\u2026"), color: "#4d6bfe" };
    }
    if (s.bin) return { text: t("\u5DF2\u914D\u7F6E \xB7 \u672A\u8FD0\u884C"), color: cssVars.text2 };
    return { text: t("\u672A\u914D\u7F6E \xB7 \u672A\u8FD0\u884C"), color: cssVars.text2 };
  }, [cfState, cfStatusError, cfInFlight, cssVars.text2, t]);
  const lanQr = (0, import_react6.useMemo)(() => makeQr(lanLink), [lanLink]);
  const tunQr = (0, import_react6.useMemo)(() => makeQr(tunLink), [tunLink]);
  const cfQr = (0, import_react6.useMemo)(() => makeQr(cfLink), [cfLink]);
  const pairLink = (base, scheme, token, candidates = []) => scheme + "://" + base + "/pair?token=" + encodeURIComponent(token) + (candidates.length ? "&base=" + encodeURIComponent(candidates.join(",")) : "");
  const mintFor = async (base, scheme, setLink, setHint, candidates = []) => {
    try {
      const r = await hostCall("token.mint");
      const link = pairLink(base, scheme, r.token, candidates);
      setLink(link);
      setHint({
        text: t("10 \u5206\u949F\u6709\u6548 \xB7 \u4E00\u6B21\u6027 \xB7 \u626B\u7801/\u6253\u5F00\u5373\u914D\u5BF9"),
        color: "#2fbf71"
      });
    } catch (e) {
      setHint({ text: t("\u94F8\u9020\u5931\u8D25\uFF1A{message}", { message: e.message }), color: "#e5484d" });
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
    "div",
    {
      "data-remote-access-panel": "1",
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxWidth: 640
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { fontSize: 15, fontWeight: 600 }, children: t("\u8FDC\u7A0B\u8BBF\u95EE") }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { color: cssVars.text2, fontSize: 13 }, children: t("\u4E09\u4E2A\u901A\u9053\u72EC\u7ACB\u7EF4\u62A4\u914D\u5BF9\u4E8C\u7EF4\u7801\uFF1A\u626B\u7801/\u6253\u5F00\u94FE\u63A5\u5373\u53EF\u914D\u5BF9\uFF08\u4E00\u6B21\u6027\u4EE4\u724C + \u8BBE\u5907\u8EAB\u4EFD\uFF09\u3002\u6B64\u9875\u9762\u4F9B\u624B\u673A/\u5176\u5B83\u8BBE\u5907\u8FDE\u63A5\u672C\u673A\u3002") }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          ChannelCard,
          {
            label: t("\u5C40\u57DF\u7F51"),
            desc: t("\u624B\u673A\u8FDE\u540C\u4E00 WiFi\uFF0C\u626B\u6B64\u7801\u76F4\u8FDE\uFF08\u4EC5\u5C40\u57DF\u7F51\u53EF\u8FBE\uFF09\u3002"),
            cssVars,
            link: lanLink,
            qrSrc: lanQr,
            hint: lanHint,
            actions: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                PanelButton,
                {
                  text: t("\u94F8\u9020\u5C40\u57DF\u7F51\u4EE4\u724C"),
                  cssVars,
                  onClick: async () => {
                    if (!lanBaseRef.current) await refreshLanBase();
                    if (lanBaseRef.current) {
                      await mintFor(
                        lanBaseRef.current.base,
                        lanBaseRef.current.scheme,
                        setLanLink,
                        setLanHint,
                        lanBaseRef.current.candidates
                      );
                    } else {
                      setLanHint({ text: t("\u65E0\u6CD5\u786E\u5B9A\u5C40\u57DF\u7F51\u5730\u5740"), color: "#e5484d" });
                    }
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                PanelButton,
                {
                  text: t("\u590D\u5236\u94FE\u63A5"),
                  ghost: true,
                  cssVars,
                  onClick: async ({ flash }) => {
                    if (!lanLink) return;
                    try {
                      await navigator.clipboard?.writeText(lanLink);
                    } catch {
                    }
                    flash("ok", t("\u5DF2\u590D\u5236 \u2713"));
                  }
                }
              )
            ] })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          ChannelCard,
          {
            label: t("\u7B2C\u4E09\u65B9\u96A7\u9053\uFF08cpolar \u7B49\uFF09"),
            desc: t("\u96A7\u9053\u9700\u6307\u5411\u6539\u5199\u4EE3\u7406\u7AEF\u53E3 127.0.0.1:{port}\uFF1B\u7C98\u8D34\u5730\u5740\u6821\u9A8C\u53EF\u8FBE\u540E\uFF0C\u7528\u6B64\u5730\u5740\u751F\u6210\u81EA\u5DF1\u7684\u914D\u5BF9\u4E8C\u7EF4\u7801\u3002", { port: lanePort }),
            cssVars,
            link: tunLink,
            qrSrc: tunQr,
            hint: tunHint,
            beforeLink: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                "input",
                {
                  type: "text",
                  placeholder: "https://xxxx.cpolar.cn",
                  value: tunInputValue,
                  onChange: (e) => setTunInputValue(e.target.value),
                  style: {
                    background: "transparent",
                    border: "1px solid var(--dsw-alias-border-l2, #ffffff1f)",
                    color: "inherit",
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontSize: 13
                  }
                }
              ),
              tunResult.text && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { color: tunResult.color, fontSize: 12 }, children: tunResult.text })
            ] }),
            actions: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                PanelButton,
                {
                  text: t("\u6821\u9A8C\u5E76\u4FDD\u5B58"),
                  ghost: true,
                  cssVars,
                  onClick: async () => {
                    setTunResult({ text: t("\u6821\u9A8C\u4E2D\u2026"), color: cssVars.text2 });
                    const url = tunInputValue.trim();
                    if (!url) {
                      setTunResult({ text: t("\u8BF7\u8F93\u5165\u96A7\u9053\u5730\u5740"), color: "#e5484d" });
                      return;
                    }
                    try {
                      const r = await hostCall("tunnel.probe", { url });
                      if (r.ok) {
                        await hostCall("tunnel.save", { url });
                        setTunSavedUrl(url);
                        setTunResult({
                          text: t("\u2713 \u53EF\u8FBE\u5DF2\u4FDD\u5B58\uFF08HTTP {status}\uFF09", { status: r.status ?? "" }),
                          color: "#2fbf71"
                        });
                        await refreshLanBase();
                      } else {
                        setTunResult({
                          text: t("\u2717 \u4E0D\u53EF\u8FBE\uFF1A{reason}", { reason: r.reason ?? "" }),
                          color: "#e5484d"
                        });
                      }
                    } catch (e) {
                      setTunResult({
                        text: t("\u6821\u9A8C\u5931\u8D25\uFF1A{message}", { message: e.message }),
                        color: "#e5484d"
                      });
                    }
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                PanelButton,
                {
                  text: t("\u94F8\u9020\u96A7\u9053\u4EE4\u724C"),
                  cssVars,
                  onClick: async () => {
                    if (!tunSavedUrl) await refreshLanBase();
                    if (tunSavedUrl) {
                      const u = new URL(tunSavedUrl);
                      await mintFor(
                        u.host,
                        u.protocol === "https:" ? "https" : "http",
                        setTunLink,
                        setTunHint
                      );
                    } else {
                      setTunHint({
                        text: t("\u8BF7\u5148\u6821\u9A8C\u5E76\u4FDD\u5B58\u96A7\u9053\u5730\u5740"),
                        color: "#e5484d"
                      });
                    }
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                PanelButton,
                {
                  text: t("\u590D\u5236\u94FE\u63A5"),
                  ghost: true,
                  cssVars,
                  onClick: async ({ flash }) => {
                    if (!tunLink) return;
                    try {
                      await navigator.clipboard?.writeText(tunLink);
                    } catch {
                    }
                    flash("ok", t("\u5DF2\u590D\u5236 \u2713"));
                  }
                }
              )
            ] })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          ChannelCard,
          {
            label: t("cloudflared \u516C\u7F51\u96A7\u9053"),
            desc: t("PATH \u6709 cloudflared \u5C31\u76F4\u63A5\u7528\uFF1B\u5426\u5219 ~/.dsh/bin \u7F13\u5B58\u547D\u4E2D\u590D\u7528\uFF1B\u90FD\u6CA1\u6709\u5C31\u4E00\u952E\u4ECE GitHub/ghproxy \u7B49\u591A\u955C\u50CF\u4E0B\u8F7D\u5230\u7F13\u5B58\u3002"),
            cssVars,
            link: cfLink,
            qrSrc: cfQr,
            hint: cfHint,
            beforeLink: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                "input",
                {
                  type: "text",
                  placeholder: t("cloudflared \u5B8C\u6574\u8DEF\u5F84\uFF08\u7559\u7A7A = \u4E00\u952E\u542F\u52A8\uFF09"),
                  value: cfInputValue,
                  onChange: (e) => setCfInputValue(e.target.value),
                  style: {
                    background: "transparent",
                    border: "1px solid var(--dsw-alias-border-l2, #ffffff1f)",
                    color: "inherit",
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontSize: 13
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { color: cfStatus.color, fontSize: 12 }, children: cfStatus.text })
            ] }),
            actions: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                PanelButton,
                {
                  text: t("\u4E00\u952E\u542F\u52A8\uFF08\u65E0\u4F9D\u8D56\uFF09"),
                  cssVars,
                  onClick: async () => {
                    setCfInFlight({
                      text: t("\u89E3\u6790\u4E2D \xB7 \u68C0\u67E5 PATH \u4E0E\u672C\u5730\u7F13\u5B58\u2026"),
                      color: "#4d6bfe"
                    });
                    setCfStatusError(null);
                    try {
                      const r = await hostCall("cloudflared.apply", { bin: "" });
                      setCfState({
                        bin: r.bin ?? "",
                        url: r.url ?? null,
                        running: !!r.running,
                        reason: r.running ? null : r.reason ?? null,
                        message: r.message,
                        phase: r.phase ?? "resolving",
                        detail: ""
                      });
                      setCfStatusError(null);
                      setCfInFlight(null);
                    } catch (e) {
                      setCfInFlight(null);
                      setCfStatusError(t("\u4E00\u952E\u542F\u52A8\u5931\u8D25\uFF1A{message}", { message: e.message }));
                    }
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                PanelButton,
                {
                  text: t("\u505C\u6B62"),
                  ghost: true,
                  cssVars,
                  onClick: async () => {
                    try {
                      await hostCall("cloudflared.stop");
                      setCfState((prev) => ({
                        bin: prev.bin,
                        url: null,
                        running: false,
                        reason: null,
                        phase: "idle",
                        detail: t("\u5DF2\u505C\u6B62"),
                        message: ""
                      }));
                      setCfStatusError(null);
                    } catch (e) {
                      setCfStatusError(t("\u505C\u6B62\u5931\u8D25\uFF1A{message}", { message: e.message }));
                    }
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                PanelButton,
                {
                  text: t("\u5E94\u7528\u5E76\u542F\u52A8"),
                  cssVars,
                  onClick: async () => {
                    setCfInFlight({ text: t("\u5E94\u7528\u4E2D\u2026"), color: cssVars.text2 });
                    setCfStatusError(null);
                    try {
                      const r = await hostCall("cloudflared.apply", {
                        bin: cfInputValue.trim()
                      });
                      setCfState({
                        bin: r.bin ?? "",
                        url: r.url ?? null,
                        running: !!r.running,
                        reason: r.running ? null : r.reason ?? null,
                        message: r.message,
                        phase: r.phase ?? "resolving",
                        detail: ""
                      });
                      setCfStatusError(null);
                      setCfInFlight(null);
                    } catch (e) {
                      setCfInFlight(null);
                      setCfStatusError(t("\u5E94\u7528\u5931\u8D25\uFF1A{message}", { message: e.message }));
                    }
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                PanelButton,
                {
                  text: t("\u94F8\u9020\u96A7\u9053\u4EE4\u724C"),
                  cssVars,
                  onClick: async () => {
                    if (!cfState.url) {
                      setCfHint({
                        text: t("\u96A7\u9053\u672A\u8FD0\u884C\u6216\u65E0\u5730\u5740\uFF0C\u8BF7\u5148\u542F\u52A8 cloudflared"),
                        color: "#e5484d"
                      });
                      return;
                    }
                    await mintFor(
                      cfState.url.replace(/^https?:\/\//, ""),
                      cfState.url.startsWith("https") ? "https" : "http",
                      setCfLink,
                      setCfHint
                    );
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                PanelButton,
                {
                  text: t("\u590D\u5236\u94FE\u63A5"),
                  ghost: true,
                  cssVars,
                  onClick: async ({ flash }) => {
                    if (!cfLink) return;
                    try {
                      await navigator.clipboard?.writeText(cfLink);
                    } catch {
                    }
                    flash("ok", t("\u5DF2\u590D\u5236 \u2713"));
                  }
                }
              )
            ] })
          }
        )
      ]
    }
  );
}
function RemoteDevicesSection({ hostCall: hostCall2 }) {
  const [tab, setTab] = (0, import_react6.useState)("share");
  const tabStyle = (active) => ({
    font: "inherit",
    fontSize: 13,
    padding: "7px 14px",
    border: "none",
    borderBottom: active ? "2px solid var(--dsw-alias-label-primary, #e7eaf0)" : "2px solid transparent",
    background: "transparent",
    color: active ? "var(--dsw-alias-label-primary, #e7eaf0)" : "var(--dsw-alias-label-secondary, #9aa4b2)",
    fontWeight: active ? 600 : 400,
    cursor: "pointer"
  });
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", gap: 4, borderBottom: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", style: tabStyle(tab === "share"), onClick: () => setTab("share"), children: "\u8BBE\u5907\u5206\u4EAB" }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", style: tabStyle(tab === "manage"), onClick: () => setTab("manage"), children: "\u8BBE\u5907\u7BA1\u7406" })
    ] }),
    tab === "share" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RemoteAccessPanel, {}) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RemoteDeviceManager, { hostCall: hostCall2 })
  ] });
}
//! 远程调用的策略（spec #103）。
//!
//! 远程会话是镜像：A 执行，B 只是把操作转发过去。交互代理（#151）落地后写开关已打开——发消息、停止、
//! 切模型、命令、审批、提问都放行，一律转发到 A，绝不落到本地执行（那会往镜像里写事件、和远端回流的事件撞车）。
//! 宿主的 remoteSession.invoke 与客户端的拦截层共用这一份裁决，两边不会各说各话。
//! 旧的「导入 / 推送 / 流转」入口已被「接管（#154）/ 回推（#155）」取代，各有独立开关，对应票落地前不开放。
//! 只读镜像模式下，放行项必须逐条登记，清单之外一律拒绝。
//! 打开外部链接（#150）：优先交给桌面壳用系统浏览器打开；纯浏览器环境退回新标签页。
//! 本期不在内嵌视图里打开远程 UI——那会让「这是另一台机器的 DSH」这件事变得看不出。
//! 设备组网在界面上的呈现（#156）。
//! - 被介绍方：有人经介绍人来敲门时，在会话区上方弹一张审批卡，写明「经谁介绍」，由本机用户同意或拒绝；
//!   绝不因为双方都信任介绍人就自动配对。
//! - 发起方：设备管理里每位介绍人的卡片下列出同组设备与请求进度（见 peer-group.jsx）。
//! 设备管理里的「同组设备」区（#156）：列出某位介绍人名下的其它设备，发起配对并显示进度。
//! 清单与介绍凭证都来自介绍人（remotePeers.list）；点「请求配对」后由对方弹审批卡决定。
//! 对方拒绝过的不再列出，不留半配状态；介绍人离线时保留上一次的清单，已配对的同组设备照常可用。
//! 设备管理：新增设备 + 可折叠设备卡片（工作区与会话）。
//! 设备信息全部来自插件自己的存储（remoteHosts.list），不再读桌面设置。
//! 连接必须双向成功才添加——host 侧 remoteHosts.pair 会回调对端，失败即回滚。
//! 会话菜单里「分享到远程…」的可见性判定。
//! 只有**本机会话**能分享：它的本体在这台机器上，分享给另一台设备是「同一份日志的另一个视图」。
//! 远程会话的本体在别的设备上，再分享出去既没有语义也没有数据源，因此整个菜单项不渲染。
//! 「分享到远程」的对话框。
//! 菜单项被点一下，官方菜单就会卸载——对话框不能长在菜单的子树里，否则刚挂上就跟着没了。
//! 所以这里用原生 DOM 直接挂在 document.body 上，生命周期与菜单无关。
//! 样式全部走 DSH 的语义 token，跟随主题。
//! 会话菜单里的「分享到远程」入口。
//! 分享不复制会话：会话始终在本机，对端只是同一份日志的另一个视图。
//! 这里只负责建立/撤销分享关系，同步由 SSE 推送自动完成。
//! 侧栏「本地 / 远程 / 全部」切换（#149）。
//! 官方侧栏没有槽位，只能在 DOM 层注入：按「远程工作区 / 远程会话」的标记过滤官方已有的行，
//! 不另建第二套列表。主题插件 dsh-claude-style 自带同类下拉（DOM 带 `data-dsh-claude-*`），
//! 两个下拉叠在一起会互相遮挡，所以检测到它时不注入，回退为「单列表 + 设备徽标」。
//! 检测信号与回退都写日志，不静默。上次选择记在 localStorage，按 profile 隔离。
//! 发送失败后把正文放回输入框。
//! 远程会话的请求发不出去时，内容留在消息记录里会让人以为「发出去了、只是在等回复」。
//! 这里把它退回输入框：用户可以直接重试，记录里也不会留一条没有回答的消息。
//! 远程访问的轻量提示。
//! 转发失败必须让人看见：远程会话的请求不会再退回本机，界面上如果还是没反应，
//! 用户会以为「点了没生效」。这里用一个独立浮层把原因直接贴出来。
//! 交互卡片（#151）：A 上的提问 / 审批在远程会话里显示成一张卡片，用户的回答经本机宿主交回 A。
//! 镜像会话上不留本机 agent（见 remote-gate.js 的说明），官方提问界面不会为它出现，所以由插件自己渲染。
//! 这里只做三件事：把宿主给的交互整理成视图模型、把用户的选择整理成回答、在输入区上方渲染卡片。
//! 不碰网络：取交互与交回答案都由装配处（client.source.jsx）经宿主完成。
//! 会话接管在会话页上的呈现（#154）。
//! 两种横幅，都挂在输入区上方（与交互卡片同一个位置，不同时出现）：
//! - 镜像会话 + 设备离线：说明设备不可达，并给出唯一的显式动作「接管为本地分支」；
//! - 本地分支：标明出处「本地分支（来自 <主机> / <原会话>，自 seq N）」。
//! 入口只在设备离线时出现，不做自动切换。
//! 远程会话 / 远程工作区上，一次官方 RPC 该怎么处理（spec #103）。
//! 远程会话是镜像：A 执行，B 只是把操作转发过去。交互代理（#151）落地后，发消息、停止、切模型、
//! 命令、审批、提问都**接管并转发**到 A。写开关关闭（只读镜像模式）时同样接管，只是裁决从「转发」
//! 变成「拒绝」——一旦不接管，官方调用就会落到本机宿主：在镜像会话上起一个本机 agent 真的跑起来，
//! 还把事件写进镜像，比转发到远端更糟。
//! 这里只做判定，不碰网络，也不碰界面。哪些远端调用放行与宿主共用 remote-policy，两边不会各说各话。
return module.exports;
  }
});

