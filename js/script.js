// let the editor know that `Chart` is defined by some code
// included in another file (in this case, `index.html`)
// Note: the code will still work without this line, but without it you
// will see an error in the editor
/* global Chart */
/* global Graph */
/* global numeral */
/* global colorjoe */

'use strict';

let device;

const bufferSize = 64;
const colors = ['#00a7e9', '#f89521', '#be1e2d'];
const measurementPeriodId = '0001';

const maxLogLength = 500;
const log = document.getElementById('log');
const butConnect = document.getElementById('butConnect');
const butClear = document.getElementById('butClear');
const autoscroll = document.getElementById('autoscroll');
const showTimestamp = document.getElementById('showTimestamp');
const lightSS = document.getElementById('light');
const darkSS = document.getElementById('dark');
const dashboard = document.getElementById('dashboard');
const fpsCounter = document.getElementById("fpsCounter");
const knownOnly = document.getElementById("knownonly");

let colorIndex = 0;
let activePanels = [];
let bytesReceived = 0;
let currentBoard;
let buttonState = 0;

function setOtaaButtonsEnabled(enabled) {
  const rde = document.getElementById('read_device_eui');
  const wde = document.getElementById('write_device_eui');
  const rae = document.getElementById('read_app_eui');
  const wae = document.getElementById('write_app_eui');
  const rak = document.getElementById('read_app_key');
  const wak = document.getElementById('write_app_key');
  const ide = document.getElementById('device_eui');
  const iae = document.getElementById('app_eui');
  const iak = document.getElementById('app_key');
  if (rde) rde.disabled = !enabled;
  if (wde) wde.disabled = !enabled;
  if (rae) rae.disabled = !enabled;
  if (wae) wae.disabled = !enabled;
  if (rak) rak.disabled = !enabled;
  if (wak) wak.disabled = !enabled;
  if (ide) ide.disabled = !enabled;
  if (iae) iae.disabled = !enabled;
  if (iak) iak.disabled = !enabled;
  if (!enabled) {
    if (ide) ide.value = '';
    if (iae) iae.value = '';
    if (iak) iak.value = '';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Sayfa yüklendi, debug aktif.');
    const notSupported = document.getElementById('notSupported');
  if (!('bluetooth' in navigator)) {
    notSupported.style.display = 'block';
  } else {
    notSupported.style.display = 'none';
  }
  butConnect.addEventListener('click', clickConnect);
  // Eğer log göster/gizle butonu varsa onu da burada ekle
  const toggleLog = document.getElementById('toggleLog');
  if (toggleLog) {
    toggleLog.addEventListener('click', () => {
      const logArea = document.getElementById('log');
      if (logArea.style.display === 'block') {
        logArea.style.display = 'none';
      } else {
        logArea.style.display = 'block';
      }
    });
  }
  // Diğer eski butonlar kaldırıldı
  loadAllSettings();
  updateTheme();
  await updateAllPanels();
  setOtaaButtonsEnabled(false);
  const writeAllBtn = document.getElementById('write_all');
  const ide = document.getElementById('device_eui');
  const iae = document.getElementById('app_eui');
  const iak = document.getElementById('app_key');
  // Uyarı mesajları için alanlar ekle
  function ensureWarningSpan(input) {
    let warn = input.nextElementSibling;
    if (!warn || !warn.classList || !warn.classList.contains('input-warning')) {
      warn = document.createElement('span');
      warn.className = 'input-warning';
      warn.style.display = 'block';
      warn.style.color = '#c41c1c';
      warn.style.fontSize = '0.95em';
      warn.style.marginTop = '2px';
      input.parentNode.insertBefore(warn, input.nextSibling);
    }
    return warn;
  }
  if (writeAllBtn && ide && iae && iak) {
    const checkInputs = () => {
      console.log('checkInputs tetiklendi');
      let valid = true;
      // Device EUI
      let v = ide ? ide.value.trim() : '';
      let warn = ide ? ensureWarningSpan(ide) : null;
      console.log('Device EUI:', v, 'length:', v.length, 'hex:', /^[0-9a-fA-F]*$/.test(v), 'disabled:', ide ? ide.disabled : 'yok', 'DOM:', !!ide);
      if (!/^[0-9a-fA-F]*$/.test(v)) {
        if (warn) warn.textContent = 'Sadece hexadecimal karakter girilebilir (0-9, A-F).';
        valid = false;
      } else if (v.length !== 16) {
        if (warn) warn.textContent = 'Tam 8 byte (16 hex karakter) girin.';
        valid = false;
      } else {
        if (warn) warn.textContent = '';
      }
      // APP EUI
      v = iae ? iae.value.trim() : '';
      warn = iae ? ensureWarningSpan(iae) : null;
      console.log('APP EUI:', v, 'length:', v.length, 'hex:', /^[0-9a-fA-F]*$/.test(v), 'disabled:', iae ? iae.disabled : 'yok', 'DOM:', !!iae);
      if (!/^[0-9a-fA-F]*$/.test(v)) {
        if (warn) warn.textContent = 'Sadece hexadecimal karakter girilebilir (0-9, A-F).';
        valid = false;
      } else if (v.length !== 16) {
        if (warn) warn.textContent = 'Tam 8 byte (16 hex karakter) girin.';
        valid = false;
      } else {
        if (warn) warn.textContent = '';
      }
      // APP Key
      v = iak ? iak.value.trim() : '';
      warn = iak ? ensureWarningSpan(iak) : null;
      console.log('APP KEY:', v, 'length:', v.length, 'hex:', /^[0-9a-fA-F]*$/.test(v), 'disabled:', iak ? iak.disabled : 'yok', 'DOM:', !!iak);
      if (!/^[0-9a-fA-F]*$/.test(v)) {
        if (warn) warn.textContent = 'Sadece hexadecimal karakter girilebilir (0-9, A-F).';
        valid = false;
      } else if (v.length !== 32) {
        if (warn) warn.textContent = 'Tam 16 byte (32 hex karakter) girin.';
        valid = false;
      } else {
        if (warn) warn.textContent = '';
      }
      // Buton aktifliği
      console.log('valid:', valid, 'disabled:', ide ? ide.disabled : 'yok', iae ? iae.disabled : 'yok', iak ? iak.disabled : 'yok', 'writeAllBtn:', writeAllBtn ? writeAllBtn.disabled : 'yok');
      if (valid && ide && iae && iak && !ide.disabled && !iae.disabled && !iak.disabled) {
        writeAllBtn.disabled = false;
      } else {
        writeAllBtn.disabled = true;
      }
    };
    ide.addEventListener('input', checkInputs);
    iae.addEventListener('input', checkInputs);
    iak.addEventListener('input', checkInputs);
    // setInterval(checkInputs, 500); // kaldırıldı, sadece input event ile kontrol
    writeAllBtn.addEventListener('click', async () => {
      await writeAll();
      writeAllBtn.disabled = true;
    });
    // Sayfa yüklenince de ilk kontrolü yap
    checkInputs();
  }
});

const boards = {
  GB_LoRa: {
    colorOrder: 'GRB',
    neopixels: 0,
    hasSwitch: false,
    buttons: 1,
  }
}

let panels = {
  device_eui: {
    title: 'Device EUI',
    serviceId: 'lora_service',
    characteristicId: 'device_eui',
    panelType: 'custom',
    properties: ['read', 'write'],
  },
  app_eui: {
    title: 'APP EUI',
    serviceId: 'lora_service',
    characteristicId: 'app_eui',
    panelType: 'custom',
    properties: ['read', 'write'],
  },
  app_key: {
    title: 'APP Key',
    serviceId: 'lora_service',
    characteristicId: 'app_key',
    panelType: 'custom',
    properties: ['read', 'write'],
  }
};

function playSound(frequency, duration, callback) {
  if (callback === undefined) {
    callback = function() {};
  }

  let value = encodePacket('tone', [frequency, duration]);
  panels.tone.characteristic.writeValue(value)
    .catch(error => {console.log(error);})
    .then(callback);
}

function encodePacket(panelId, values) {
  const typeMap = {
    "Uint8":    {fn: DataView.prototype.setUint8,    bytes: 1},
    "Uint16":   {fn: DataView.prototype.setUint16,   bytes: 2},
    "Uint32":   {fn: DataView.prototype.setUint32,   bytes: 4},
    "Int32":    {fn: DataView.prototype.setInt32,    bytes: 4},
    "Float32":  {fn: DataView.prototype.setFloat32,  bytes: 4},
  };

  if (values.length != panels[panelId].packetSequence.length) {
    logMsg("Error in encodePacket(): Number of arguments must match structure");
    return false;
  }

  let bufferSize = 0, packetPointer = 0;
  panels[panelId].packetSequence.forEach(function(dataType) {
    bufferSize += typeMap[dataType].bytes;
  });

  let view = new DataView(new ArrayBuffer(bufferSize));

  for (var i = 0; i < values.length; i++) {
    let dataType = panels[panelId].packetSequence[i];
    let dataViewFn = typeMap[dataType].fn.bind(view);
    dataViewFn(packetPointer, values[i], true);
    packetPointer += typeMap[dataType].bytes;
  }

  return view.buffer;
}

/**
 * @name connect
 * Opens a Web Serial connection to a micro:bit and sets up the input and
 * output stream.
 */
async function connect() {
  try {
    logMsg('Bluetooth cihazları aranıyor...');
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
      optionalServices: [
        '0000abcd-0000-1000-8000-00805f9b34fb'
      ]
    });
    logMsg('Cihaz seçildi: ' + device.name);
    const server = await device.gatt.connect();
    logMsg('Bluetooth bağlantısı kuruldu.');
    return server;
  } catch (error) {
    logMsg('Bluetooth bağlantısı başarısız: ' + error);
    throw error;
  }
}

async function readActiveSensors() {
  for (let panelId of activePanels) {
    let panel = panels[panelId];
    if (panels[panelId].properties.includes("read") || panels[panelId].properties.includes("notify")) {
      await panels[panelId].characteristic.readValue().then(function(data){handleIncoming(panelId, data);});
    }
  }
}

function handleIncoming(panelId, value) {
  const columns = Object.keys(panels[panelId].data);
  const typeMap = {
    "Uint8":    {fn: DataView.prototype.getUint8,    bytes: 1},
    "Uint16":   {fn: DataView.prototype.getUint16,   bytes: 2},
    "Uint32":   {fn: DataView.prototype.getUint32,   bytes: 4},
    "Float32":  {fn: DataView.prototype.getFloat32,  bytes: 4}
  };

  let packetPointer = 0, i = 0;
  panels[panelId].structure.forEach(function(dataType) {
    let dataViewFn = typeMap[dataType].fn.bind(value);
    let unpackedValue = dataViewFn(packetPointer, true);
    panels[panelId].data[columns[i]].push(unpackedValue);
    if (panels[panelId].data[columns[i]].length > bufferSize) {
      panels[panelId].data[columns[i]].shift();
    }
    packetPointer += typeMap[dataType].bytes;
    bytesReceived += typeMap[dataType].bytes;
    i++;
  });

  panels[panelId].rendered = false;
}

/**
 * @name disconnect
 * Closes the Web Bluetooth connection.
 */
async function disconnect() {
  if (device && device.gatt.connected) {
    device.gatt.disconnect();
  }
}

function getFullId(shortId) {
  if (shortId.length == 9) {
    return '9b489064-' + shortId + '-a1eb-0242ac120002';
  }
  return shortId;
}

function logMsg(text) {
  // Update the Log
  if (typeof showTimestamp !== 'undefined' && showTimestamp && showTimestamp.checked) {
    let d = new Date();
    let timestamp = d.getHours() + ":" + `${d.getMinutes()}`.padStart(2, 0) + ":" +
        `${d.getSeconds()}`.padStart(2, 0) + "." + `${d.getMilliseconds()}`.padStart(3, 0);
    log.innerHTML += '<span class="timestamp">' + timestamp + ' -> </span>';
    d = null;
  }
  log.innerHTML += text+ "<br>";

  // Remove old log content
  if (log.textContent.split("\n").length > maxLogLength + 1) {
    let logLines = log.innerHTML.replace(/(\n)/gm, "").split("<br>");
    log.innerHTML = logLines.splice(-maxLogLength).join("<br>\n");
  }

  if (typeof autoscroll !== 'undefined' && autoscroll && autoscroll.checked) {
    log.scrollTop = log.scrollHeight
  }
}

/**
 * @name updateTheme
 * Sets the theme to  Adafruit (dark) mode. Can be refactored later for more themes
 */
function updateTheme() {
  // Disable all themes
  const alternates = document.querySelectorAll('link[rel=stylesheet].alternate');
  if (alternates && alternates.length > 0) {
    alternates.forEach((styleSheet) => {
      enableStyleSheet(styleSheet, false);
    });
  }
  enableStyleSheet(typeof lightSS !== 'undefined' && lightSS ? lightSS : document.getElementById('light'), true);
}

function enableStyleSheet(node, enabled) {
  if (!node) return;
  node.disabled = !enabled;
}

/**
 * @name reset
 * Reset the Panels, Log, and associated data
 */
async function reset() {
  // Clear the data
  clearGraphData();

  // Clear all Panel Data
  for (let panelId of activePanels) {
    let panel = panels[panelId];
    if (panels[panelId].data !== undefined) {
      Object.entries(panels[panelId].data).forEach(([field, item], index) => {
        panels[panelId].data[field] = [];
      });
    }
    panels[panelId].rendered = false;
  }

  bytesReceived = 0;
  colorIndex = 0;

  // Clear the log
  log.innerHTML = "";
}

/**
 * @name clickConnect
 * Click handler for the connect/disconnect button.
 */
async function clickConnect() {
  if (device && device.gatt && device.gatt.connected) {
    await disconnect();
    setOtaaButtonsEnabled(false);
    toggleUIConnected(false);
    return;
  }
  butConnect.textContent = 'Bağlanıyor...';
  try {
    await connect();
    setOtaaButtonsEnabled(true);
    toggleUIConnected(true);
    logMsg('Bluetooth cihazları başarıyla bulundu ve bağlanıldı.');
    try {
      await readValue('device_eui');
      await readValue('app_eui');
      await readValue('app_key');
    } catch (e) {
      logMsg('Bağlantı kuruldu fakat cihazdan veri okunamadı: ' + e);
      setOtaaButtonsEnabled(false);
    }
  } catch (e) {
    setOtaaButtonsEnabled(false);
    logMsg('Bluetooth cihazı bulunamadı veya bağlantı reddedildi.');
  }
  butConnect.textContent = device && device.gatt && device.gatt.connected ? 'Bağlantıyı Kes' : 'Cihaza Bağlan';
}

async function onDisconnected(event) {
  let disconnectedDevice = event.target;

  for (let panelId of activePanels) {
    if (typeof panels[panelId].polling !== 'undefined') {
      clearInterval(panels[panelId].polling);
    }
  }

  // Loop through activePanels and remove them
  destroyPanels();

  toggleUIConnected(false);
  logMsg('Device ' + disconnectedDevice.name + ' is disconnected.');

  device = undefined;
  currentBoard = undefined;
  setOtaaButtonsEnabled(false);
}

/**
 * @name clickAutoscroll
 * Change handler for the Autoscroll checkbox.
 */
async function clickAutoscroll() {
  saveSetting('autoscroll', autoscroll.checked);
}

/**
 * @name clickTimestamp
 * Change handler for the Show Timestamp checkbox.
 */
async function clickTimestamp() {
  saveSetting('timestamp', showTimestamp.checked);
}

/**
 * @name clickKnownOnly
 * Change handler for the Show Only Known Devices checkbox.
 */
async function clickKnownOnly() {
  saveSetting('knownonly', knownOnly.checked);
}

/**
 * @name clickClear
 * Click handler for the clear button.
 */
async function clickClear() {
  reset();
}

function convertJSON(chunk) {
  try {
    let jsonObj = JSON.parse(chunk);
    return jsonObj;
  } catch (e) {
    return chunk;
  }
}

function toggleUIConnected(connected) {
  let lbl = 'Cihaza Bağlan';
  const status = document.getElementById('connection-status');
  if (connected) {
    lbl = 'Bağlantıyı Kes';
    if (status) {
      status.textContent = 'Bağlı';
      status.classList.remove('disconnected');
      status.classList.add('connected');
    }
  } else {
    if (status) {
      status.textContent = 'Bağlı Değil';
      status.classList.remove('connected');
      status.classList.add('disconnected');
    }
  }
  butConnect.textContent = lbl;
}

function loadAllSettings() {
  // Load all saved settings or defaults
  var _autoscroll = typeof autoscroll !== 'undefined' && autoscroll ? autoscroll : document.getElementById('autoscroll');
  var _showTimestamp = typeof showTimestamp !== 'undefined' && showTimestamp ? showTimestamp : document.getElementById('showTimestamp');
  var _knownOnly = typeof knownOnly !== 'undefined' && knownOnly ? knownOnly : document.getElementById('knownonly');
  if (_autoscroll) _autoscroll.checked = loadSetting('autoscroll', true);
  if (_showTimestamp) _showTimestamp.checked = loadSetting('timestamp', false);
  if (_knownOnly) _knownOnly.checked = loadSetting('knownonly', true);
}

function loadSetting(setting, defaultValue) {
  let value = JSON.parse(window.localStorage.getItem(setting));
  if (value == null) {
    return defaultValue;
  }

  return value;
}

function saveSetting(setting, value) {
  window.localStorage.setItem(setting, JSON.stringify(value));
}

async function finishDrawing() {
  return new Promise(requestAnimationFrame);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateAllPanels() {
  for (let panelId of activePanels) {
    updatePanel(panelId);
  }

  // wait for frame to finish and request another frame
  await finishDrawing();
  await updateAllPanels();
}

function updatePanel(panelId) {
  if (!panels[panelId].rendered) {
    if (panels[panelId].panelType == "text") {
      updateTextPanel(panelId);
    } else if (panels[panelId].panelType == "graph") {
      updateGraphPanel(panelId);
    } else if (panels[panelId].panelType == "model3d") {
      update3dPanel(panelId);
    } else if (panels[panelId].panelType == "custom") {
      updateCustomPanel(panelId);
    }
    panels[panelId].rendered = true;
  }
}

function createPanel(panelId) {
  if (panels.hasOwnProperty(panelId)) {
    if (panels[panelId].panelType == "text") {
      createTextPanel(panelId);
    } else if (panels[panelId].panelType == "graph") {
      createGraphPanel(panelId);
    } else if (panels[panelId].panelType == "color") {
      createColorPanel(panelId);
    } else if (panels[panelId].panelType == "model3d") {
      create3dPanel(panelId);
    } else if (panels[panelId].panelType == "custom") {
      createCustomPanel(panelId);
    }
    panels[panelId].rendered = true;
    activePanels.push(panelId);
  }
}

function destroyPanels() {
  let activePanelCount = activePanels.length;
  for (let i = 0; i < activePanelCount; i++) {
    let itemToRemove = activePanels.pop();
    document.querySelector("#dashboard > #" + itemToRemove).remove();
  }
}

function clearGraphData() {
  for (let panelId of activePanels) {
    let panel = panels[panelId];
    if (panel.panelType == "graph") {
      panel.graph.clear();
    }
  }
}

function ucWords(text) {
  return text.replace('_', ' ').toLowerCase().replace(/(?<= )[^\s]|^./g, a=>a.toUpperCase())
}

function loadPanelTemplate(panelId, templateId) {
  if (templateId == undefined) {
    templateId = panels[panelId].panelType;
  }
    // Create Panel from Template
  let panelTemplate = document.querySelector("#templates > ." + templateId).cloneNode(true);
  panelTemplate.id = panelId;
  if (panels[panelId].title !== undefined) {
    panelTemplate.querySelector(".title").innerHTML = panels[panelId].title;
  } else {
    panelTemplate.querySelector(".title").innerHTML = ucWords(panelId);
  }

  dashboard.appendChild(panelTemplate)

  return panelTemplate;
}

/* Text Panel */
function createTextPanel(panelId) {
  // Create Panel from Template
  let panelTemplate = loadPanelTemplate(panelId);
  panelTemplate.querySelector(".content p").innerHTML = "-";
  if (panels[panelId].style !== undefined) {
    panelTemplate.querySelector(".content").style = panels[panelId].style;
  }
}

function updateTextPanel(panelId) {
  let panelElement = document.querySelector("#dashboard > #" + panelId);
  let panelContent = [];
  Object.entries(panels[panelId].data).forEach(([field, item], index) => {
    let value = "";
    if (panels[panelId].data[field].length > 0) {
      value = panels[panelId].data[field].pop(); // Show only the last piece of data
      panels[panelId].data[field] = [];
      if (panels[panelId].textFormat !== undefined) {
        value = panels[panelId].textFormat(value);
      }
    }
    if (value !== "") {
      panelContent.push(value);
    }
  });
  if (panelContent.length == 0) {
    panelContent = "-";
  } else {
    panelContent = panelContent.join("<br>");
  }
  panelElement.querySelector(".content p").innerHTML = panelContent;
}

/* Graph Panel */
function createGraphPanel(panelId) {
  // Create Panel from Template
  let panelTemplate = loadPanelTemplate(panelId);
  let canvas = panelTemplate.querySelector(".content canvas");

  // Create a canvas
  panels[panelId].graph = new Graph(canvas);
  panels[panelId].graph.create(false);

  // Setup graph
  Object.entries(panels[panelId].data).forEach(([field, item], index) => {
    panels[panelId].graph.addDataSet(field, colors[(colorIndex + index) % colors.length]);
    // Create text spans for each dataset and set the color here
    let textField = document.createElement('div');
    textField.style.color = colors[(colorIndex + index) % colors.length];
    textField.id = field;
    panelTemplate.querySelector(".content .text p").appendChild(textField);
  });
  colorIndex += Object.entries(panels[panelId].data).length;

  panels[panelId].graph.update();
}

function updateGraphPanel(panelId) {
  let panelElement = document.querySelector("#dashboard > #" + panelId);
  let panelContent = [];
  let multipleEntries = Object.entries(panels[panelId].data).length > 1;

  // Set Graph Data to match
  Object.entries(panels[panelId].data).forEach(([field, item], index) => {
    if (panels[panelId].data[field].length > 0) {
      let value = null;
      while(panels[panelId].data[field].length > 0) {
        value = panels[panelId].data[field].shift();
        panels[panelId].graph.addValue(index, value, false);
      }
      if (panels[panelId].textFormat !== undefined) {
        value = panels[panelId].textFormat(value);
      }
      if (value !== null) {
        if (multipleEntries) {
          value = ucWords(field) + ": " + value;
        }
        panelElement.querySelector(".content .text p #" + field).innerHTML = value;
      }
    } else {
      panels[panelId].graph.clearValues(index);
      if (multipleEntries) {
        panelElement.querySelector(".content .text p #" + field).innerHTML = ucWords(field) + ': -';
      } else {
        panelElement.querySelector(".content .text p #" + field).innerHTML = '-';
      }
    }

  });

  panels[panelId].graph.flushBuffer();
}

/* Color Panel */
function createColorPanel(panelId) {
  // Create Panel from Template
  let panelTemplate = loadPanelTemplate(panelId);

  let container = panelTemplate.querySelector('.content div');
  panels[panelId].colorPicker = colorjoe.rgb(container, 'red');

  // Update the panel packet sequence to match the number of LEDs on board
  panels[panelId].packetSequence = panels[panelId].structure.slice(0, 2);
  let dataType = panels[panelId].structure[2].replace(/\[\]/, '');
  for (let i = 0; i < currentBoard.neopixels * 3; i++) {
    panels[panelId].packetSequence.push(dataType);
  }

  // RGB Color Picker
  function updateModelLed(color) {
    logMsg("Changing neopixel to " + color.hex());
    let orderedColors = adjustColorOrder(Math.round(color.r() * 255),
                                         Math.round(color.g() * 255),
                                         Math.round(color.b() * 255));
    let values = [0, 1].concat(new Array(currentBoard.neopixels).fill(orderedColors).flat());
    let packet = encodePacket(panelId, values);
    panels[panelId].characteristic.writeValue(packet)
    .catch(error => {console.log(error);})
    .then(_ => {});
  }

  function adjustColorOrder(red, green, blue) {
    // Add more as needed
    switch(currentBoard.colorOrder) {
      case 'GRB':
        return [green, red, blue];
      default:
        return [red, green, blue];
    }
  }

  panels[panelId].colorPicker.on('done', updateModelLed);
}

/* 3D Panel */
function create3dPanel(panelId) {
  let panelTemplate = loadPanelTemplate(panelId);
  let canvas = panelTemplate.querySelector(".content canvas");

  // Make it visually fill the positioned parent
  canvas.style.width ='100%';
  canvas.style.height='100%';
  // ...then set the internal size to match
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  // Create a 3D renderer and camera
  panels[panelId].renderer = new THREE.WebGLRenderer({canvas});

  panels[panelId].camera = new THREE.PerspectiveCamera(45, canvas.width/canvas.height, 0.1, 100);
  panels[panelId].camera.position.set(0, -5, 30);

  // Set up the Scene
  panels[panelId].scene = new THREE.Scene();
  panels[panelId].scene.background = new THREE.Color('black');
  {
    const skyColor = 0xB1E1FF;  // light blue
    const groundColor = 0x999999;  // gray
    const intensity = 1;
    const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
    panels[panelId].scene.add(light);
  }

  {
    const color = 0xFFFFFF;
    const intensity = 3;
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(0, 10, 0);
    light.target.position.set(-5, 0, 0);
    panels[panelId].scene.add(light);
    panels[panelId].scene.add(light.target);
  }

  {
    const color = 0xFFFFFF;
    const intensity = 1;
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(0, -10, 0);
    light.target.position.set(5, 0, 0);
    panels[panelId].scene.add(light);
    panels[panelId].scene.add(light.target);
  }

  function frameArea(sizeToFitOnScreen, boxSize, boxCenter, camera) {
    const halfSizeToFitOnScreen = sizeToFitOnScreen * 0.5;
    const halfFovY = THREE.MathUtils.degToRad(camera.fov * 0.5);
    const distance = halfSizeToFitOnScreen / Math.tan(halfFovY);
    // compute a unit vector that points in the direction the camera is now
    // in the xz plane from the center of the box
    const direction = (new THREE.Vector3())
        .subVectors(camera.position, boxCenter)
        .multiply(new THREE.Vector3(1, 0, 1))
        .normalize();

    // move the camera to a position distance units way from the center
    // in whatever direction the camera was from the center already
    camera.position.copy(direction.multiplyScalar(distance).add(boxCenter));

    // pick some near and far values for the frustum that
    // will contain the box.
    camera.near = boxSize / 100;
    camera.far = boxSize * 100;

    camera.updateProjectionMatrix();

    // point the camera to look at the center of the box
    camera.lookAt(boxCenter.x, boxCenter.y, boxCenter.z);
  }

  {
    const gltfLoader = new GLTFLoader();
    gltfLoader.load('https://cdn.glitch.com/eeed3166-9759-4ba5-ba6b-aed272d6db80%2Fbunny.glb', (gltf) => {
      const root = gltf.scene;
      panels[panelId].model = root;
      panels[panelId].scene.add(root);

      const box = new THREE.Box3().setFromObject(root);

      const boxSize = box.getSize(new THREE.Vector3()).length();
      const boxCenter = box.getCenter(new THREE.Vector3());

      frameArea(boxSize * 1.25, boxSize, boxCenter, panels[panelId].camera);
    });
  }
}

function update3dPanel(panelId) {
  let panelElement = document.querySelector("#dashboard > #" + panelId);

  function resizeRendererToDisplaySize(renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }
    return needResize;
  }
  // Set Graph Data to match
  if (resizeRendererToDisplaySize(panels[panelId].renderer)) {
    const canvas = panels[panelId].renderer.domElement;
    panels[panelId].camera.aspect = canvas.clientWidth / canvas.clientHeight;
    panels[panelId].camera.updateProjectionMatrix();
  }

  let quaternion = {w: 1, x: 0, y: 0, z:0};
  Object.entries(panels[panelId].data).forEach(([field, item], index) => {
    if (panels[panelId].data[field].length > 0) {
      let value = panels[panelId].data[field].pop(); // Show only the last piece of data
      quaternion[field] = value;
      panels[panelId].data[field] = [];
    }
  });

  if (panels[panelId].model != undefined) {
    let rotObjectMatrix = new THREE.Matrix4();
    let rotationQuaternion = new THREE.Quaternion(quaternion.y, quaternion.z, quaternion.x, quaternion.w);
    rotObjectMatrix.makeRotationFromQuaternion(rotationQuaternion);
    panels[panelId].model.quaternion.setFromRotationMatrix(rotObjectMatrix);
  }

  panels[panelId].renderer.render(panels[panelId].scene, panels[panelId].camera);
}

function createCustomPanel(panelId) {
  if (panels[panelId].condition === undefined || panels[panelId].condition()) {
    if (panels[panelId].create != undefined) {
      panels[panelId].create(panelId);
    }
  }
}

function updateCustomPanel(panelId) {
  if (panels[panelId].condition === undefined || panels[panelId].condition()) {
    if (panels[panelId].update != undefined) {
      panels[panelId].update(panelId);
    }
  }
}

function createMockPanels() {
  currentBoard = boards.CLUE;
  for (let panelId of Object.keys(panels)) {
    if (panels[panelId].condition == undefined || panels[panelId].condition()) {
      // Non-custom ones such as battery are always active
      createPanel(panelId);
    }
  }
}

async function readValue(type) {
  try {
    if (!device || !device.gatt || !device.gatt.connected) throw 'Bluetooth bağlantısı yok.';
    const SERVICE_UUID = '0000abcd-0000-1000-8000-00805f9b34fb';
    let CHAR_UUID = '';
    let inputId = '';
    if (type === 'device_eui') {
      CHAR_UUID = '0000a001-0000-1000-8000-00805f9b34fb';
      inputId = 'device_eui';
    } else if (type === 'app_eui') {
      CHAR_UUID = '0000a002-0000-1000-8000-00805f9b34fb';
      inputId = 'app_eui';
    } else if (type === 'app_key') {
      CHAR_UUID = '0000a003-0000-1000-8000-00805f9b34fb';
      inputId = 'app_key';
    } else {
      throw 'Bilinmeyen karakteristik tipi';
    }
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHAR_UUID);
    const value = await characteristic.readValue();
    // 8 veya 16 byte'ı hex string olarak göster
    let hex = '';
    for (let i = 0; i < value.byteLength; i++) {
      hex += value.getUint8(i).toString(16).padStart(2, '0').toUpperCase();
    }
    document.getElementById(inputId).value = hex;
    logMsg(inputId + ' okundu: ' + hex);
  } catch (e) {
    logMsg(type + ' okunamadı: ' + e);
    throw e;
  }
}

async function writeAll() {
  try {
    if (!device || !device.gatt || !device.gatt.connected) throw 'Bluetooth bağlantısı yok.';
    const SERVICE_UUID = '0000abcd-0000-1000-8000-00805f9b34fb';
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    // Device EUI
    let value = document.getElementById('device_eui').value.trim();
    if (value.length !== 16) throw 'Device EUI 8 byte (16 hex karakter) olmalı.';
    let buffer = new Uint8Array(8);
    for (let i = 0; i < 8; i++) buffer[i] = parseInt(value.substr(i*2,2),16);
    let char1 = await service.getCharacteristic('0000a001-0000-1000-8000-00805f9b34fb');
    await char1.writeValue(buffer);
    // APP EUI
    value = document.getElementById('app_eui').value.trim();
    if (value.length !== 16) throw 'APP EUI 8 byte (16 hex karakter) olmalı.';
    buffer = new Uint8Array(8);
    for (let i = 0; i < 8; i++) buffer[i] = parseInt(value.substr(i*2,2),16);
    let char2 = await service.getCharacteristic('0000a002-0000-1000-8000-00805f9b34fb');
    await char2.writeValue(buffer);
    // APP Key
    value = document.getElementById('app_key').value.trim();
    if (value.length !== 32) throw 'APP Key 16 byte (32 hex karakter) olmalı.';
    buffer = new Uint8Array(16);
    for (let i = 0; i < 16; i++) buffer[i] = parseInt(value.substr(i*2,2),16);
    let char3 = await service.getCharacteristic('0000a003-0000-1000-8000-00805f9b34fb');
    await char3.writeValue(buffer);
    logMsg('Tüm ayarlar başarıyla cihaza yazıldı.');
  } catch (e) {
    logMsg('Ayarlar yazılamadı: ' + e);
  }
}
