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
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_source_exports);
var import_react4 = __toESM(require("react"), 1);

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
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
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
var buttonStyle = {
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
  ...buttonStyle,
  borderColor: "var(--dsw-alias-label-primary, #e7eaf0)",
  fontWeight: 500
};
var ghostStyle = {
  ...buttonStyle,
  borderColor: "transparent",
  color: "var(--dsw-alias-label-secondary, #9aa4b2)"
};
var dangerStyle = {
  ...buttonStyle,
  borderColor: "transparent",
  color: "#e5484d"
};
var STATE_COLOR = { online: "#16a34a", offline: "#9ca3af", unpaired: "#f59e0b", incompatible: "#ef4444" };
function Chevron({ open }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
  const [hosts, setHosts] = (0, import_react2.useState)([]);
  const [states, setStates] = (0, import_react2.useState)({});
  const [workspaces, setWorkspaces] = (0, import_react2.useState)([]);
  const [sessions, setSessions] = (0, import_react2.useState)({});
  const [open, setOpen] = (0, import_react2.useState)({});
  const [renaming, setRenaming] = (0, import_react2.useState)(null);
  const [draft, setDraft] = (0, import_react2.useState)("");
  const [addr, setAddr] = (0, import_react2.useState)("");
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [notice, setNotice] = (0, import_react2.useState)(null);
  const refresh = (0, import_react2.useCallback)(async () => {
    try {
      const [hostState, wsState] = await Promise.all([
        hostCall2("remoteHosts.list"),
        hostCall2("remoteWorkspace.list")
      ]);
      const list = Array.isArray(hostState?.hosts) ? hostState.hosts : [];
      setHosts(list);
      setWorkspaces(Array.isArray(wsState?.workspaces) ? wsState.workspaces : []);
      const next = {};
      await Promise.all(list.map(async (host) => {
        try {
          const result = await hostCall2("remoteStatus.probe", { hostId: host.hostId });
          const state = result?.status?.state;
          if (typeof state === "string") next[host.hostId] = state;
        } catch {
        }
      }));
      setStates(next);
    } catch (error) {
      setNotice({ kind: "error", text: String(error?.message ?? error) });
    }
  }, [hostCall2]);
  (0, import_react2.useEffect)(() => {
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
  const [confirming, setConfirming] = (0, import_react2.useState)(null);
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
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: cardStyle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 13, fontWeight: 600 }, children: "\u65B0\u589E\u8BBE\u5907" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", lineHeight: 1.6 }, children: "\u7C98\u8D34\u5BF9\u7AEF lane \u94F8\u9020\u7684\u8FDE\u63A5\u5730\u5740\u3002\u8FDE\u63A5\u6210\u529F\u624D\u4F1A\u6DFB\u52A0\u2014\u2014\u6DFB\u52A0\u540E\u53CC\u65B9\u4E92\u76F8\u767B\u8BB0\uFF0C\u4EFB\u4F55\u4E00\u65B9\u90FD\u80FD\u53D1\u8D77\u4F1A\u8BDD\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "input",
        {
          style: inputStyle,
          value: addr,
          placeholder: "dsh://192.168.1.42:3091/pair?token=...",
          onChange: (event) => setAddr(event.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: primaryStyle, disabled: busy, onClick: addDevice, children: "\u8FDE\u63A5\u5E76\u6DFB\u52A0" }),
        notice !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 12, color: notice.kind === "error" ? "#e5484d" : notice.kind === "ok" ? "#16a34a" : "var(--dsw-alias-label-secondary, #9aa4b2)" }, children: notice.text }) : null
      ] })
    ] }),
    hosts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: cardStyle, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }, children: "\u8FD8\u6CA1\u6709\u6DFB\u52A0\u4EFB\u4F55\u8BBE\u5907\u3002" }) }) : null,
    hosts.map((host) => {
      const state = states[host.hostId] ?? "offline";
      const isOpen = open[host.hostId] === true;
      const mine = workspaces.filter((workspace) => workspace.hostId === host.hostId);
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...cardStyle, padding: 0, gap: 0, overflow: "hidden" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "div",
          {
            style: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer" },
            onClick: () => toggle(host.hostId),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { width: 8, height: 8, borderRadius: "50%", background: STATE_COLOR[state] ?? "#9ca3af", flex: "none" } }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }, children: [
                  renaming === host.hostId ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
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
                  ) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: host.renamedAt !== void 0 && host.name !== "" ? host.name : host.origin }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontSize: 11, padding: "1px 7px", borderRadius: 999, border: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)", color: STATE_COLOR[state] ?? "#9ca3af" }, children: state === "online" ? "\u5DF2\u8FDE\u63A5" : state === "unpaired" ? "\u672A\u914D\u5BF9" : state === "incompatible" ? "\u7248\u672C\u4E0D\u7B26" : "\u5DF2\u65AD\u5F00" })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", marginTop: 3 }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: host.origin }),
                  host.model ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: host.model }) : null,
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
                    "ID ",
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { style: { fontFamily: "var(--font-mono, monospace)", fontSize: 11 }, children: host.deviceId })
                  ] })
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: ghostStyle, onClick: (event) => {
                event.stopPropagation();
                setRenaming(host.hostId);
                setDraft(host.name ?? "");
              }, children: "\u91CD\u547D\u540D" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: ghostStyle, onClick: (event) => {
                event.stopPropagation();
                void reconnect(host.hostId);
              }, children: "\u91CD\u8FDE" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: dangerStyle, onClick: (event) => {
                event.stopPropagation();
                setConfirming({ kind: "device", id: host.hostId, label: host.renamedAt !== void 0 && host.name !== "" ? host.name : host.origin });
              }, children: "\u5220\u9664" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Chevron, { open: isOpen })
            ]
          }
        ),
        isOpen ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { borderTop: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)", padding: "12px 14px" }, children: [
          mine.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }, children: "\u8FD9\u53F0\u8BBE\u5907\u4E0A\u8FD8\u6CA1\u6709\u767B\u8BB0\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u3002" }) : null,
          mine.map((workspace) => {
            const key = host.hostId + "|" + workspace.path;
            const rows = sessions[key];
            return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { marginBottom: 12 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, marginBottom: 4 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: workspace.title }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }, children: workspace.path })
              ] }),
              rows === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", padding: "4px 8px" }, children: "\u52A0\u8F7D\u4E2D\u2026" }) : rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #9aa4b2)", padding: "4px 8px" }, children: "\u8FD9\u4E2A\u5DE5\u4F5C\u533A\u8FD8\u6CA1\u6709\u4F1A\u8BDD" }) : rows.map((session) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, fontSize: 13 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: session.title || session.id }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: dangerStyle, onClick: () => setConfirming({ kind: "session", id: session.id, label: session.title || session.id }), children: "\u5F52\u6863" })
              ] }, session.id))
            ] }, workspace.path);
          })
        ] }) : null
      ] }, host.hostId);
    }),
    confirming !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "div",
      {
        style: { position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" },
        onClick: () => setConfirming(null),
        children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "div",
          {
            style: { width: 380, maxWidth: "90vw", padding: 18, borderRadius: 12, background: "var(--dsw-alias-bg-layer-1, #171a21)", border: "1px solid var(--dsw-alias-border-l2, #2a2f3a)", display: "flex", flexDirection: "column", gap: 12 },
            onClick: (event) => event.stopPropagation(),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 14, fontWeight: 600 }, children: confirming.kind === "device" ? "\u5220\u9664\u8BBE\u5907" : "\u5F52\u6863\u4F1A\u8BDD" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 13, lineHeight: 1.6, color: "var(--dsw-alias-label-secondary, #9aa4b2)" }, children: confirming.kind === "device" ? `\u786E\u5B9A\u5220\u9664\u300C${confirming.label}\u300D\uFF1F\u8FD9\u53F0\u8BBE\u5907\u7684\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u767B\u8BB0\u4F1A\u4E00\u5E76\u79FB\u9664\uFF0C\u5BF9\u7AEF\u4E0D\u53D7\u5F71\u54CD\u3002` : `\u786E\u5B9A\u5F52\u6863\u300C${confirming.label}\u300D\uFF1F\u5F52\u6863\u540E\u5B83\u4F1A\u4ECE\u4FA7\u8FB9\u680F\u6D88\u5931\u3002` }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: buttonStyle, onClick: () => setConfirming(null), children: "\u53D6\u6D88" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
                  "button",
                  {
                    type: "button",
                    style: { ...buttonStyle, borderColor: "#e5484d", color: "#e5484d" },
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

// client/remote-directory-flow.jsx
var import_react3 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime3 = require("react/jsx-runtime");
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
  const [source, setSource] = (0, import_react3.useState)("local");
  const [hosts, setHosts] = (0, import_react3.useState)([]);
  const [hostId, setHostId] = (0, import_react3.useState)("");
  const [listing, setListing] = (0, import_react3.useState)(null);
  const [current, setCurrent] = (0, import_react3.useState)("");
  const [draft, setDraft] = (0, import_react3.useState)("");
  const [error, setError] = (0, import_react3.useState)(null);
  const [working, setWorking] = (0, import_react3.useState)(false);
  const browse = (0, import_react3.useCallback)(async (targetHostId, targetPath, quiet = false) => {
    if (targetHostId === "") return;
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
  }, [hostCall2, t]);
  (0, import_react3.useEffect)(() => {
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
        if (first !== "") await browse(first, "");
      } catch (reason) {
        setError(String(reason?.message ?? reason));
      }
    })();
  }, [open, hostCall2, browse]);
  (0, import_react3.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    import_dsh_client_ui_primitives.Modal,
    {
      open,
      onClose: onCancel,
      title: t("\u6DFB\u52A0\u5DE5\u4F5C\u533A"),
      closeLabel: t("\u5173\u95ED"),
      description: t("\u9009\u4E00\u4E2A\u672C\u673A\u76EE\u5F55\uFF0C\u6216\u4ECE\u5DF2\u914D\u5BF9\u7684\u4E3B\u673A\u4E0A\u6311\u4E00\u4E2A\u76EE\u5F55\u3002"),
      footer: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", onClick: onCancel, children: t("\u53D6\u6D88") }),
        source === "remote" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          import_dsh_client_ui_primitives.Button,
          {
            variant: "primary",
            onClick: () => void commit(),
            disabled: busy || working || current === "" || hostId === "",
            children: t("\u4F7F\u7528\u6B64\u76EE\u5F55")
          }
        ) : null
      ] }),
      children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: columnStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.SegmentedTabs, { items: tabs, value: source, onChange: setSource, label: t("\u76EE\u5F55\u6765\u6E90"), size: "sm" }),
        source === "local" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { id: "dsh-rdf-panel-local", role: "tabpanel", "aria-labelledby": "dsh-rdf-tab-local", style: columnStyle, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", onClick: () => void pickLocalDirectory(), disabled: busy, children: t("\u9009\u62E9\u672C\u673A\u76EE\u5F55\u2026") }) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { id: "dsh-rdf-panel-remote", role: "tabpanel", "aria-labelledby": "dsh-rdf-tab-remote", style: columnStyle, children: [
          hosts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: t("\u8FD8\u6CA1\u6709\u5DF2\u914D\u5BF9\u7684\u4E3B\u673A\u3002\u5148\u5230\u300C\u8BBE\u7F6E \u2192 \u8FDC\u7A0B\u8BBF\u95EE\u300D\u914D\u5BF9\u4E00\u53F0\uFF0C\u518D\u56DE\u6765\u6DFB\u52A0\u5B83\u7684\u76EE\u5F55\u3002") }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: chipsStyle, children: hosts.map((host) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              import_dsh_client_ui_primitives.Button,
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
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("nav", { "aria-label": t("\u5F53\u524D\u8DEF\u5F84"), style: chipsStyle, children: segmentsOf(current).map((segment) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              import_dsh_client_ui_primitives.Button,
              {
                variant: "ghost",
                size: "sm",
                onClick: () => void browse(hostId, segment.path),
                children: segment.name
              },
              segment.path
            )) }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: pathRowStyle, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", disabled: working || draft === "", onClick: () => void browse(hostId, draft), children: t("\u524D\u5F80") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: listStyle, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", size: "sm", style: rowButtonStyle, onClick: () => void browse(hostId, parentOf(current)), children: t(".. \u4E0A\u4E00\u7EA7") }),
              (listing?.entries ?? []).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                import_dsh_client_ui_primitives.Button,
                {
                  variant: "ghost",
                  size: "sm",
                  style: rowButtonStyle,
                  onClick: () => void browse(hostId, entry.path),
                  children: entry.name
                },
                entry.path
              )),
              (listing?.entries ?? []).length === 0 && !working ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: t("\uFF08\u6CA1\u6709\u5B50\u76EE\u5F55\uFF09") }) : null
            ] })
          ] }),
          error === null ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: error })
        ] })
      ] })
    }
  );
}

// client/workspace-badge.js
var BADGE_ATTR = "data-dsh-remote-workspace";
var LABEL_ATTR = "data-dsh-remote-label";
var BADGE_PREFIX = "\u8FDC\u7A0B";
var STATE_COLORS = {
  online: "#16a34a",
  offline: "#9ca3af",
  unpaired: "#f59e0b",
  incompatible: "#ef4444"
};
function paintBadge(label, text, title, state) {
  const color = STATE_COLORS[state] ?? "";
  const existing = label.querySelector(`[${BADGE_ATTR}]`);
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
    "user-select:none"
  ].join(";");
  badge.append(dot, caption);
  label.appendChild(badge);
}
function installRemoteWorkspaceBadge({ hostCall: hostCall2, intervalMs = 15e3 }) {
  if (typeof document === "undefined") return () => {
  };
  let titles = /* @__PURE__ */ new Map();
  let hostIds = /* @__PURE__ */ new Map();
  let states = /* @__PURE__ */ new Map();
  let shareCounts = /* @__PURE__ */ new Map();
  let stopped = false;
  let observer = null;
  let timer = null;
  const repaint = () => {
    if (stopped || titles.size === 0) return;
    const labels = document.querySelectorAll(
      '[role="treeitem"] span, [role="treeitem"] div,[role="menuitem"] span, [role="menuitem"] div,[role="option"] span, [role="option"] div'
    );
    for (const label of labels) {
      const foreign = [...label.children].some((child) => !child.hasAttribute(BADGE_ATTR));
      if (foreign) continue;
      const text = label.getAttribute(LABEL_ATTR) ?? (label.textContent ?? "").trim();
      const entry = titles.get(text);
      if (entry === void 0) continue;
      const name = entry.name;
      const state = states.get(entry.hostId);
      label.setAttribute(LABEL_ATTR, text);
      paintBadge(label, name === "" ? BADGE_PREFIX : `${BADGE_PREFIX} \xB7 ${name}`, name, state);
    }
  };
  const repaintShares = () => {
    if (stopped || shareCounts.size === 0) return;
    for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
      const key = row.getAttribute("data-row-key") ?? "";
      const sessionId = key.slice("session:".length);
      const count = shareCounts.get(sessionId);
      if (count === void 0 || count === 0) continue;
      const label = row.querySelector("span, div");
      if (label === null) continue;
      paintBadge(label, `\u5206\u4EAB \xB7 ${count}`, `\u5DF2\u5206\u4EAB\u7ED9 ${count} \u53F0\u8BBE\u5907`, "online");
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
        next.set(workspace.title, { name, hostId });
        const streamState = typeof workspace.streamState === "string" ? workspace.streamState : "";
        if (streamState !== "") {
          const mapped = streamState === "connected" ? "online" : streamState === "connecting" ? "unpaired" : "offline";
          if (hostId !== "") states.set(hostId, mapped);
          for (const sessionId of workspace.sessionIds ?? []) {
            if (typeof sessionId === "string") sessionStates.set(sessionId, mapped);
          }
        }
        if (typeof workspace.streamState === "string") {
          const mapped = workspace.streamState === "connected" ? "online" : workspace.streamState === "connecting" ? "unpaired" : "offline";
          if (hostId !== "") states.set(hostId, mapped);
        }
        if (hostId !== "") hostIdsNext.add(hostId);
      }
      titles = next;
      hostIds = hostIdsNext;
      const probed = /* @__PURE__ */ new Map();
      await Promise.all([...hostIds].map(async (hostId) => {
        try {
          const result = await hostCall2("remoteStatus.probe", { hostId });
          const state2 = result?.status?.state;
          if (typeof state2 === "string") probed.set(hostId, state2);
        } catch {
          const previous = states.get(hostId);
          if (previous !== void 0) probed.set(hostId, previous);
        }
      }));
      states = probed;
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
    } catch {
    }
  };
  void refresh();
  timer = setInterval(() => {
    void refresh();
  }, intervalMs);
  observer = new MutationObserver(() => {
    repaint();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    observer?.disconnect();
    for (const badge of document.querySelectorAll(`[${BADGE_ATTR}]`)) badge.remove();
  };
}

// client/client.source.jsx
var import_jsx_runtime4 = require("react/jsx-runtime");
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
function apply(ctx) {
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
      () => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RemoteAccessI18nProvider, { t, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RemoteDevicesSection, { hostCall }) })
    )
  );
  slots.inject(
    "sidebar.workspaces.session.menu.item",
    () => slots.register(
      { name: "sidebar.workspaces.session.menu.item", id: "dsh-remote-sync", order: 900 },
      (menuProps) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RemoteAccessI18nProvider, { t, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
      () => slots.register({ name: hole, priority: -1, inject: flowInjected }, (flowProps) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RemoteAccessI18nProvider, { t, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RemoteDirectoryFlow, { ...flowProps }) }))
    );
  }
  try {
    const uninstallBadge = installRemoteWorkspaceBadge({ hostCall });
    ctx?.on?.("dispose", uninstallBadge);
  } catch (error) {
    ctx?.logger?.warn?.(`dsh-remote-access: \u8FDC\u7A0B\u5DE5\u4F5C\u533A\u5FBD\u6807\u672A\u5B89\u88C5\uFF08${String(error)}\uFF09`);
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
                if (!message.includes("not-found")) {
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
      const FORWARD = /* @__PURE__ */ new Set([
        "session/rename",
        "session/fork",
        "session/updateQueue",
        "session/attachment",
        "session/openWorkspacePath",
        "session/workspacePathApplications",
        "commands/execute",
        "commands/list",
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
        // 终端：pty 必须开在 A 机上。
        "terminal/create",
        "terminal/close",
        "terminal/rename",
        "terminal/list",
        "terminal/shells",
        "terminal/environment",
        // 工作区与会话的菜单操作：改名、删除、归档、置顶都要落到 A 机。
        "workspace/rename",
        "workspace/delete",
        "workspace/archiveSession",
        "workspace/unarchiveSession",
        "workspace/pinSession",
        "workspace/unpinSession"
      ]);
      let inside = false;
      rpcService.call = async (channel, endpoint, payload, signal) => {
        if (inside || channel !== "/api" || !FORWARD.has(endpoint)) return originalCall(channel, endpoint, payload, signal);
        const args = payload && payload.args ? payload.args : {};
        const slash = endpoint.indexOf("/");
        const namespace = endpoint.slice(0, slash);
        const method = endpoint.slice(slash + 1);
        inside = true;
        try {
          const result = await hostCall("remoteSession.invoke", { namespace, method, args });
          if (result && result.value !== void 0) return { ok: true, value: result.value };
        } catch (error) {
          const message = String(error?.message ?? error);
          if (!message.includes("not-found")) {
            console.warn("dsh-remote-access: \u8FDC\u7A0B\u8C03\u7528\u5931\u8D25 " + endpoint + "\uFF1A" + message);
            return { ok: false, error: { code: "remote-failed", message } };
          }
        } finally {
          inside = false;
        }
        return originalCall(channel, endpoint, payload, signal);
      };
      console.info("dsh-remote-access: \u4F20\u8F93\u5C42\u8F6C\u53D1\u5DF2\u5B89\u88C5");
      const STREAM_FORWARD = /* @__PURE__ */ new Set([
        "terminal/attach",
        "terminal/retain",
        "job/list",
        "job/follow",
        "workspaceFiles/changes"
      ]);
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
        if (channel !== "/api" || !STREAM_FORWARD.has(endpoint)) return void 0;
        const args = payload && payload.args ? payload.args : {};
        const sessionId = pickSession(args);
        if (sessionId === void 0) return void 0;
        return openRemoteStream(endpoint, args, sessionId, signal, uplink);
      };
      console.info("dsh-remote-access: \u6D41\u5F0F\u8F6C\u53D1\u5DF2\u5B89\u88C5");
    }
  } catch (error) {
    ctx?.logger?.warn?.(`dsh-remote-access: \u4F20\u8F93\u5C42\u8F6C\u53D1\u672A\u5B89\u88C5\uFF08${String(error)}\uFF09`);
  }
}
var lanePort = Number(globalThis.__DSH_REMOTE_LANE_PORT__) || 3091;
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
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [flash, setFlash] = (0, import_react4.useState)(null);
  const [flashText, setFlashText] = (0, import_react4.useState)(null);
  const flashTimerRef = (0, import_react4.useRef)(null);
  (0, import_react4.useEffect)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { fontSize: 13, fontWeight: 600 }, children: label }),
        desc && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { color: cssVars.text2, fontSize: 12 }, children: desc }),
        beforeLink,
        link && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
        qrSrc && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
        hint?.text && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { color: hint.color, fontSize: 12 }, children: hint.text }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: actions })
      ]
    }
  );
}
function RemoteAccessPanel() {
  const t = useRemoteAccessT();
  const cssVars = (0, import_react4.useMemo)(
    () => ({
      text: readCssVar("--dsw-alias-label-primary", "#e7eaf0"),
      text2: readCssVar("--dsw-alias-label-secondary", "#9aa4b2"),
      panel: readCssVar("--dsw-alias-bg-layer-1", "#171a21"),
      line: readCssVar("--dsw-alias-border-l2", "#2a2f3a"),
      accent: readCssVar("--dsw-alias-state-accent-primary", "#4d6bfe")
    }),
    []
  );
  (0, import_react4.useEffect)(() => {
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-remote-access", "1");
    styleEl.textContent = BUTTON_CSS;
    document.head.appendChild(styleEl);
    return () => {
      styleEl.remove();
    };
  }, []);
  const lanBaseRef = (0, import_react4.useRef)(null);
  const [lanLink, setLanLink] = (0, import_react4.useState)(null);
  const [lanHint, setLanHint] = (0, import_react4.useState)(null);
  const [tunInputValue, setTunInputValue] = (0, import_react4.useState)("");
  const [tunSavedUrl, setTunSavedUrl] = (0, import_react4.useState)("");
  const [tunResult, setTunResult] = (0, import_react4.useState)({ text: "", color: "" });
  const [tunLink, setTunLink] = (0, import_react4.useState)(null);
  const [tunHint, setTunHint] = (0, import_react4.useState)(null);
  const [cfState, setCfState] = (0, import_react4.useState)({
    bin: "",
    url: null,
    running: false,
    reason: null,
    phase: "idle",
    detail: "",
    message: ""
  });
  const [cfInputValue, setCfInputValue] = (0, import_react4.useState)("");
  const [cfInFlight, setCfInFlight] = (0, import_react4.useState)(null);
  const [cfStatusError, setCfStatusError] = (0, import_react4.useState)(null);
  const [cfLink, setCfLink] = (0, import_react4.useState)(null);
  const [cfHint, setCfHint] = (0, import_react4.useState)(null);
  const [devices, setDevices] = (0, import_react4.useState)([]);
  const [devicesError, setDevicesError] = (0, import_react4.useState)(null);
  const [deviceErrors, setDeviceErrors] = (0, import_react4.useState)({});
  const tunSavedUrlRef = (0, import_react4.useRef)("");
  tunSavedUrlRef.current = tunSavedUrl;
  const refreshDevices = (0, import_react4.useCallback)(async () => {
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
  const refreshCf = (0, import_react4.useCallback)(async () => {
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
  const refreshLanBase = (0, import_react4.useCallback)(async () => {
    try {
      const info = await hostCall("info");
      const port = info.lanePort ?? lanePort;
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
  (0, import_react4.useEffect)(() => {
    void refreshDevices();
    void refreshCf();
    void refreshLanBase();
    const id = setInterval(() => {
      void refreshDevices();
      void refreshCf();
    }, 2e3);
    return () => clearInterval(id);
  }, [refreshDevices, refreshCf, refreshLanBase]);
  (0, import_react4.useEffect)(() => {
    setCfInputValue(cfState.bin || "");
  }, [cfState.bin]);
  const cfStatus = (0, import_react4.useMemo)(() => {
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
  const lanQr = (0, import_react4.useMemo)(() => makeQr(lanLink), [lanLink]);
  const tunQr = (0, import_react4.useMemo)(() => makeQr(tunLink), [tunLink]);
  const cfQr = (0, import_react4.useMemo)(() => makeQr(cfLink), [cfLink]);
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
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { fontSize: 15, fontWeight: 600 }, children: t("\u8FDC\u7A0B\u8BBF\u95EE") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { color: cssVars.text2, fontSize: 13 }, children: t("\u4E09\u4E2A\u901A\u9053\u72EC\u7ACB\u7EF4\u62A4\u914D\u5BF9\u4E8C\u7EF4\u7801\uFF1A\u626B\u7801/\u6253\u5F00\u94FE\u63A5\u5373\u53EF\u914D\u5BF9\uFF08\u4E00\u6B21\u6027\u4EE4\u724C + \u8BBE\u5907\u8EAB\u4EFD\uFF09\u3002\u6B64\u9875\u9762\u4F9B\u624B\u673A/\u5176\u5B83\u8BBE\u5907\u8FDE\u63A5\u672C\u673A\u3002") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          ChannelCard,
          {
            label: t("\u5C40\u57DF\u7F51"),
            desc: t("\u624B\u673A\u8FDE\u540C\u4E00 WiFi\uFF0C\u626B\u6B64\u7801\u76F4\u8FDE\uFF08\u4EC5\u5C40\u57DF\u7F51\u53EF\u8FBE\uFF09\u3002"),
            cssVars,
            link: lanLink,
            qrSrc: lanQr,
            hint: lanHint,
            actions: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          ChannelCard,
          {
            label: t("\u7B2C\u4E09\u65B9\u96A7\u9053\uFF08cpolar \u7B49\uFF09"),
            desc: t("\u96A7\u9053\u9700\u6307\u5411\u6539\u5199\u4EE3\u7406\u7AEF\u53E3 127.0.0.1:{port}\uFF1B\u7C98\u8D34\u5730\u5740\u6821\u9A8C\u53EF\u8FBE\u540E\uFF0C\u7528\u6B64\u5730\u5740\u751F\u6210\u81EA\u5DF1\u7684\u914D\u5BF9\u4E8C\u7EF4\u7801\u3002", { port: lanePort }),
            cssVars,
            link: tunLink,
            qrSrc: tunQr,
            hint: tunHint,
            beforeLink: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
              tunResult.text && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { color: tunResult.color, fontSize: 12 }, children: tunResult.text })
            ] }),
            actions: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          ChannelCard,
          {
            label: t("cloudflared \u516C\u7F51\u96A7\u9053"),
            desc: t("PATH \u6709 cloudflared \u5C31\u76F4\u63A5\u7528\uFF1B\u5426\u5219 ~/.dsh/bin \u7F13\u5B58\u547D\u4E2D\u590D\u7528\uFF1B\u90FD\u6CA1\u6709\u5C31\u4E00\u952E\u4ECE GitHub/ghproxy \u7B49\u591A\u955C\u50CF\u4E0B\u8F7D\u5230\u7F13\u5B58\u3002"),
            cssVars,
            link: cfLink,
            qrSrc: cfQr,
            hint: cfHint,
            beforeLink: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { color: cfStatus.color, fontSize: 12 }, children: cfStatus.text })
            ] }),
            actions: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
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
  const [tab, setTab] = (0, import_react4.useState)("share");
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
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", gap: 4, borderBottom: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", style: tabStyle(tab === "share"), onClick: () => setTab("share"), children: "\u8BBE\u5907\u5206\u4EAB" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", style: tabStyle(tab === "manage"), onClick: () => setTab("manage"), children: "\u8BBE\u5907\u7BA1\u7406" })
    ] }),
    tab === "share" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RemoteAccessPanel, {}) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RemoteDeviceManager, { hostCall: hostCall2 })
  ] });
}
//! 设备管理：新增设备 + 可折叠设备卡片（工作区与会话）。
//!
//! 设备信息全部来自插件自己的存储（remoteHosts.list），不再读桌面设置。
//! 连接必须双向成功才添加——host 侧 remoteHosts.pair 会回调对端，失败即回滚。
return module.exports;
  }
});

