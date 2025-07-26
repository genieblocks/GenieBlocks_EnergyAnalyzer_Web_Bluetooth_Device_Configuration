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

// LoRaWAN yeni UUID'ler
const LORAWAN_SERVICE_UUID = '0000a100-0000-1000-8000-00805f9b34fb';
const DEVEUI_CHAR_UUID = '0000a201-0000-1000-8000-00805f9b34fb';
const APPEUI_CHAR_UUID = '0000a202-0000-1000-8000-00805f9b34fb';
const APPKEY_CHAR_UUID = '0000a203-0000-1000-8000-00805f9b34fb';

// Commit (System) yeni UUID'ler
const SYSTEM_SERVICE_UUID = '0000a200-0000-1000-8000-00805f9b34fb';
const COMMIT_CHAR_UUID = '0000a210-0000-1000-8000-00805f9b34fb';

// Yeni read-only karakteristik UUID'ler
const PLATFORM_CHAR_UUID = '0000a204-0000-1000-8000-00805f9b34fb';
const FREQ_CHAR_UUID = '0000a205-0000-1000-8000-00805f9b34fb';
const PCKPO_CHAR_UUID = '0000a206-0000-1000-8000-00805f9b34fb';
const ADR_CHAR_UUID = '0000a207-0000-1000-8000-00805f9b34fb';

/**
 * @name connect
 * Opens a Web Serial connection to a micro:bit and sets up the input and
 * output stream.
 */
async function connect() {
  logMsg('Bluetooth cihazları aranıyor...');
  device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      LORAWAN_SERVICE_UUID,
      '0000a005-0000-1000-8000-00805f9b34fb', // Commit karakteristiği
      window.MODBUS_SERVICE_UUID // Modbus servisi
      // '00008018-0000-1000-8000-00805f9b34fb' // OTA servisi eklendi
    ]
  });
  logMsg('Cihaz seçildi: ' + device.name);
  const server = await device.gatt.connect();
  logMsg('Bluetooth bağlantısı kuruldu.');
  // Bağlantı kopunca arayüzü güncelle
  if (device && typeof onDisconnected === 'function') {
    device.removeEventListener('gattserverdisconnected', onDisconnected); // Çift eklenmesin diye önce kaldır
    device.addEventListener('gattserverdisconnected', onDisconnected);
  }
  return server;
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
    toggleUIConnected(false);
    [document.getElementById('device_eui'), document.getElementById('app_eui'), document.getElementById('app_key')].forEach(input => {
      if (input) {
        input.value = '';
        input.disabled = true;
      }
    });
    document.getElementById('write_all').disabled = true;
    return;
  }
  butConnect.textContent = 'Bağlanıyor...';
  try {
    await connect();
    toggleUIConnected(true);
    logMsg('Bluetooth cihazları başarıyla bulundu ve bağlanıldı.');
    try {
      await readLoRaWANAll();
      await readModbusAll();
      [document.getElementById('device_eui'), document.getElementById('app_eui'), document.getElementById('app_key')].forEach(input => {
        if (input) input.disabled = false;
      });
      document.getElementById('write_all').disabled = false;
    } catch (e) {
      logMsg('Bağlantı kuruldu fakat cihazdan veri okunamadı: ' + e);
      [document.getElementById('device_eui'), document.getElementById('app_eui'), document.getElementById('app_key')].forEach(input => {
        if (input) {
          input.value = '';
          input.disabled = true;
        }
      });
      document.getElementById('write_all').disabled = true;
    }
  } catch (e) {
    logMsg('Bluetooth cihazı bulunamadı veya bağlantı reddedildi.');
    [document.getElementById('device_eui'), document.getElementById('app_eui'), document.getElementById('app_key')].forEach(input => {
      if (input) {
        input.value = '';
        input.disabled = true;
      }
    });
    document.getElementById('write_all').disabled = true;
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

  destroyPanels();

  toggleUIConnected(false);
  logMsg('Cihaz ile bağlantı KOPTU! Lütfen tekrar bağlanın.');

  device = undefined;
  currentBoard = undefined;
  // Bağlantı kesilince inputları disable ve temizle
  [
    document.getElementById('device_eui'),
    document.getElementById('app_eui'),
    document.getElementById('app_key'),
    document.getElementById('platform'),
    document.getElementById('freq'),
    document.getElementById('pckpo'),
    document.getElementById('adr')
  ].forEach(input => {
    if (input) {
      input.value = '';
      input.disabled = true;
    }
  });
  const writeBtn = document.getElementById('write_all');
  if (writeBtn) writeBtn.disabled = true;
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
  const status = document.getElementById('connection-status');
  const commitBtn = document.getElementById('commit_and_restart');
  const readBtn = document.getElementById('read_all');
  let lbl = 'Cihaza Bağlan';
  if (connected) {
    lbl = 'Bağlantıyı Kes';
    if (status) {
      status.textContent = 'Bağlı';
      status.classList.remove('disconnected');
      status.classList.add('connected');
    }
    [document.getElementById('device_eui'), document.getElementById('app_eui'), document.getElementById('app_key')].forEach(input => {
      if (input) input.disabled = false;
    });
    const writeBtn = document.getElementById('write_all');
    if (writeBtn) writeBtn.disabled = false;
    if (commitBtn) commitBtn.disabled = false;
    if (readBtn) readBtn.disabled = false;
  } else {
    if (status) {
      status.textContent = 'Bağlı Değil';
      status.classList.remove('connected');
      status.classList.add('disconnected');
    }
    [document.getElementById('device_eui'), document.getElementById('app_eui'), document.getElementById('app_key')].forEach(input => {
      if (input) {
        input.value = '';
        input.disabled = true;
      }
    });
    // Modbus inputlarını da temizle
    const modbusInputs = document.querySelectorAll('#tab-modbus input');
    modbusInputs.forEach(input => {
      input.value = '';
      input.disabled = true;
    });
    const writeBtn = document.getElementById('write_all');
    if (writeBtn) writeBtn.disabled = true;
    if (commitBtn) commitBtn.disabled = true;
    if (readBtn) readBtn.disabled = true;
  }
  const butConnect = document.getElementById('butConnect');
  if (butConnect) butConnect.textContent = lbl;
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
    let CHAR_UUID = '';
    let inputId = '';
    let isString = false;
    if (type === 'device_eui') {
      CHAR_UUID = DEVEUI_CHAR_UUID;
      inputId = 'device_eui';
    } else if (type === 'app_eui') {
      CHAR_UUID = APPEUI_CHAR_UUID;
      inputId = 'app_eui';
    } else if (type === 'app_key') {
      CHAR_UUID = APPKEY_CHAR_UUID;
      inputId = 'app_key';
    } else if (type === 'platform') {
      CHAR_UUID = PLATFORM_CHAR_UUID;
      inputId = 'platform';
      isString = true;
    } else if (type === 'freq') {
      CHAR_UUID = FREQ_CHAR_UUID;
      inputId = 'freq';
      isString = true;
    } else if (type === 'pckpo') {
      CHAR_UUID = PCKPO_CHAR_UUID;
      inputId = 'pckpo';
    } else if (type === 'adr') {
      CHAR_UUID = ADR_CHAR_UUID;
      inputId = 'adr';
    } else {
      throw 'Bilinmeyen karakteristik tipi';
    }
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const service = await server.getPrimaryService(LORAWAN_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(CHAR_UUID);
    const value = await characteristic.readValue();
    let result = '';
    if (isString) {
      // String olarak oku
      for (let i = 0; i < value.byteLength; i++) {
        const char = value.getUint8(i);
        if (char === 0) break;
        result += String.fromCharCode(char);
      }
    } else if (type === 'adr') {
      result = value.getUint8(0) ? 'Evet' : 'Hayır';
    } else if (type === 'pckpo') {
      result = value.getUint8(0).toString();
    } else {
      // Hex string (eski alanlar)
      for (let i = 0; i < value.byteLength; i++) {
        result += value.getUint8(i).toString(16).padStart(2, '0').toUpperCase();
      }
    }
    document.getElementById(inputId).value = result;
    logMsg(inputId + ' okundu: ' + result);
  } catch (e) {
    logMsg(type + ' okunamadı: ' + e);
    throw e;
  }
}

async function writeAll() {
  try {
    if (!device || !device.gatt || !device.gatt.connected) throw 'Bluetooth bağlantısı yok.';
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const service = await server.getPrimaryService(LORAWAN_SERVICE_UUID);
    // Device EUI
    let value = document.getElementById('device_eui').value.trim();
    if (value.length !== 16) throw 'Device EUI 8 byte (16 hex karakter) olmalı.';
    let buffer = new Uint8Array(8);
    for (let i = 0; i < 8; i++) buffer[i] = parseInt(value.substr(i*2,2),16);
    let char1 = await service.getCharacteristic(DEVEUI_CHAR_UUID);
    await char1.writeValue(buffer);
    // APP EUI
    value = document.getElementById('app_eui').value.trim();
    if (value.length !== 16) throw 'APP EUI 8 byte (16 hex karakter) olmalı.';
    buffer = new Uint8Array(8);
    for (let i = 0; i < 8; i++) buffer[i] = parseInt(value.substr(i*2,2),16);
    let char2 = await service.getCharacteristic(APPEUI_CHAR_UUID);
    await char2.writeValue(buffer);
    // APP Key
    value = document.getElementById('app_key').value.trim();
    if (value.length !== 32) throw 'APP Key 16 byte (32 hex karakter) olmalı.';
    buffer = new Uint8Array(16);
    for (let i = 0; i < 16; i++) buffer[i] = parseInt(value.substr(i*2,2),16);
    let char3 = await service.getCharacteristic(APPKEY_CHAR_UUID);
    await char3.writeValue(buffer);
    logMsg('Tüm ayarlar başarıyla cihaza yazıldı.');
  } catch (e) {
    logMsg('Ayarlar yazılamadı: ' + e);
  }
}

// TAB arayüzü için sekme geçişi
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-modern').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tab-modern').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.style.display = 'none');
      this.classList.add('active');
      document.getElementById('tab-' + this.dataset.tab).style.display = '';
    });
  });
});

// Modbus servis ve karakteristik UUID'leri
defineModbusUUIDs();
function defineModbusUUIDs() {
  window.MODBUS_SERVICE_UUID = '0000a400-0000-1000-8000-00805f9b34fb';
  window.MB_ADDR_UUID     = '0000a401-0000-1000-8000-00805f9b34fb';
  window.MB_BAUD_UUID     = '0000a402-0000-1000-8000-00805f9b34fb';
  window.MB_PARITY_UUID   = '0000a403-0000-1000-8000-00805f9b34fb';
  window.MB_STOPBITS_UUID = '0000a404-0000-1000-8000-00805f9b34fb';
  window.MB_DATABITS_UUID = '0000a405-0000-1000-8000-00805f9b34fb';
  window.MB_TIMEOUT_UUID  = '0000a406-0000-1000-8000-00805f9b34fb';
  window.MB_POLLING_UUID  = '0000a407-0000-1000-8000-00805f9b34fb';
  window.MB_FUNC_UUID     = '0000a408-0000-1000-8000-00805f9b34fb';
  window.MB_REGSTART_UUID = '0000a409-0000-1000-8000-00805f9b34fb';
  window.MB_REGLEN_UUID   = '0000a40a-0000-1000-8000-00805f9b34fb';
}

// Modbus karakteristiklerini oku
async function readModbusAll() {
  try {
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const service = await server.getPrimaryService(MODBUS_SERVICE_UUID);
    document.getElementById('mb_addr').value     = (await (await service.getCharacteristic(MB_ADDR_UUID)).readValue()).getUint8(0);
    document.getElementById('mb_baud').value     = bufferToString(await (await service.getCharacteristic(MB_BAUD_UUID)).readValue());
    document.getElementById('mb_parity').value   = (await (await service.getCharacteristic(MB_PARITY_UUID)).readValue()).getUint8(0);
    document.getElementById('mb_stopbits').value = (await (await service.getCharacteristic(MB_STOPBITS_UUID)).readValue()).getUint8(0);
    document.getElementById('mb_databits').value = (await (await service.getCharacteristic(MB_DATABITS_UUID)).readValue()).getUint8(0);
    document.getElementById('mb_timeout').value  = bufferToString(await (await service.getCharacteristic(MB_TIMEOUT_UUID)).readValue());
    document.getElementById('mb_polling').value  = bufferToString(await (await service.getCharacteristic(MB_POLLING_UUID)).readValue());
    document.getElementById('mb_func').value     = (await (await service.getCharacteristic(MB_FUNC_UUID)).readValue()).getUint8(0);
    document.getElementById('mb_regstart').value = (await (await service.getCharacteristic(MB_REGSTART_UUID)).readValue()).getUint16(0, true);
    document.getElementById('mb_reglen').value   = (await (await service.getCharacteristic(MB_REGLEN_UUID)).readValue()).getUint16(0, true);
  } catch (e) {
    logMsg('Modbus verileri okunamadı: ' + e);
  }
}
function bufferToString(dataView) {
  let str = '';
  for (let i = 0; i < dataView.byteLength; i++) {
    const char = dataView.getUint8(i);
    if (char === 0) break;
    str += String.fromCharCode(char);
  }
  return str;
}

function hexStringFromBuffer(dataView) {
  let hex = '';
  for (let i = 0; i < dataView.byteLength; i++) {
    const v = dataView.getUint8(i);
    hex += v.toString(16).padStart(2, '0').toUpperCase();
  }
  return hex;
}

// LoRaWAN karakteristiklerini toplu okuma fonksiyonu
async function readLoRaWANAll() {
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  // Device EUI
  try {
    const deveuiChar = await server.getPrimaryService(LORAWAN_SERVICE_UUID).then(s => s.getCharacteristic(DEVEUI_CHAR_UUID));
    const dataView = await deveuiChar.readValue();
    logMsg('Device EUI DataView.byteLength: ' + dataView.byteLength);
    let rawArr = [];
    for (let i = 0; i < dataView.byteLength; i++) rawArr.push(dataView.getUint8(i).toString(16).padStart(2, '0'));
    logMsg('Device EUI raw bytes: ' + rawArr.join(' '));
    const value = hexStringFromBuffer(dataView);
    document.getElementById('device_eui').value = value;
    logMsg('Device EUI okundu: ' + value);
  } catch (e) {
    logMsg('Device EUI okunamadı: ' + e);
  }
  // APP EUI
  try {
    const appeuiChar = await server.getPrimaryService(LORAWAN_SERVICE_UUID).then(s => s.getCharacteristic(APPEUI_CHAR_UUID));
    const value = hexStringFromBuffer(await appeuiChar.readValue());
    document.getElementById('app_eui').value = value;
    logMsg('APP EUI okundu: ' + value);
  } catch (e) {
    logMsg('APP EUI okunamadı: ' + e);
  }
  // APP Key
  try {
    const appkeyChar = await server.getPrimaryService(LORAWAN_SERVICE_UUID).then(s => s.getCharacteristic(APPKEY_CHAR_UUID));
    const value = hexStringFromBuffer(await appkeyChar.readValue());
    document.getElementById('app_key').value = value;
    logMsg('APP Key okundu: ' + value);
  } catch (e) {
    logMsg('APP Key okunamadı: ' + e);
  }
  // Platform
  try {
    const platformChar = await server.getPrimaryService(LORAWAN_SERVICE_UUID).then(s => s.getCharacteristic(PLATFORM_CHAR_UUID));
    const value = bufferToString(await platformChar.readValue());
    document.getElementById('platform').value = value;
    logMsg('Platform okundu: ' + value);
  } catch (e) {
    logMsg('Platform okunamadı: ' + e);
  }
  // Freq
  try {
    const freqChar = await server.getPrimaryService(LORAWAN_SERVICE_UUID).then(s => s.getCharacteristic(FREQ_CHAR_UUID));
    const value = bufferToString(await freqChar.readValue());
    document.getElementById('freq').value = value;
    logMsg('Freq okundu: ' + value);
  } catch (e) {
    logMsg('Freq okunamadı: ' + e);
  }
  // PckPo
  try {
    const pckpoChar = await server.getPrimaryService(LORAWAN_SERVICE_UUID).then(s => s.getCharacteristic(PCKPO_CHAR_UUID));
    const pckpoVal = await pckpoChar.readValue();
    const value = pckpoVal.getUint8(0).toString();
    document.getElementById('pckpo').value = value;
    logMsg('PckPo okundu: ' + value);
  } catch (e) {
    logMsg('PckPo okunamadı: ' + e);
  }
  // ADR
  try {
    const adrChar = await server.getPrimaryService(LORAWAN_SERVICE_UUID).then(s => s.getCharacteristic(ADR_CHAR_UUID));
    const adrVal = await adrChar.readValue();
    const value = adrVal.getUint8(0).toString();
    document.getElementById('adr').value = value;
    logMsg('ADR okundu: ' + value);
  } catch (e) {
    logMsg('ADR okunamadı: ' + e);
  }
}

// clickConnect fonksiyonunda LoRaWAN okuma işlemlerinden sonra:
// await readModbusAll();

document.addEventListener('DOMContentLoaded', () => {
  const deviceEui = document.getElementById('device_eui');
  const appEui = document.getElementById('app_eui');
  const appKey = document.getElementById('app_key');
  [
    {el: deviceEui, max: 16, label: 'Device EUI'},
    {el: appEui, max: 16, label: 'APP EUI'},
    {el: appKey, max: 32, label: 'APP KEY'}
  ].forEach(({el, max, label}) => {
    if (!el) return;
    el.addEventListener('keyup', (event) => {
      let regEx = /^[0-9a-fA-F]+$/;
      let isHex = regEx.test(event.target.value.toString());
      if ((!isHex && event.target.value.length > 0) || event.target.value.length > max) {
        event.target.value = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, max);
      }
      console.log(label + ' input:', event.target.value);
    });
  });
  const butConnect = document.getElementById('butConnect');
  if (butConnect && typeof clickConnect === 'function') {
    butConnect.addEventListener('click', clickConnect);
  }
  // Logu Göster/Gizle butonu
  const toggleLog = document.getElementById('toggleLog');
  const logArea = document.getElementById('log');
  if (toggleLog && logArea) {
    toggleLog.addEventListener('click', () => {
      if (logArea.style.display === 'block') {
        logArea.style.display = 'none';
      } else {
        logArea.style.display = 'block';
      }
    });
  }
  console.log('Sadece hex karakter ve max uzunluk için keyup event ile kontrol aktif.');
  const commitBtn = document.getElementById('commit_and_restart');
  if (commitBtn) {
    commitBtn.addEventListener('click', async () => {
      let yazildi = false;
      try {
        if (!device || !device.gatt.connected) {
          logMsg('Cihaz bağlı değil, commit işlemi yapılamaz.');
          return;
        }
        const server = device.gatt;
        let service = await server.getPrimaryService(SYSTEM_SERVICE_UUID);
        let characteristic = await service.getCharacteristic(COMMIT_CHAR_UUID);
        await characteristic.writeValue(Uint8Array.of(0x01));
        yazildi = true;
        logMsg('Ayarlar BLE commit karakteristiğine yazıldı. Cihaz yeniden başlatılıyor (bip sesi duyulacak).');
      } catch (err) {
        // Kullanıcıya hata mesajı gösterme, sadece konsola yaz
        console.warn('Commit işlemi sırasında hata:', err);
      } finally {
        if (device && device.gatt.connected) {
          device.gatt.disconnect();
          logMsg('BLE bağlantısı yazılım tarafından sonlandırıldı.');
        } else if (!yazildi) {
          logMsg('BLE bağlantısı cihaz tarafından sonlandırıldı.');
        }
      }
    });
  }
  const readBtn = document.getElementById('read_all');
  if (readBtn) {
    readBtn.addEventListener('click', async () => {
      try {
        await readLoRaWANAll();
        await readModbusAll();
        logMsg('Cihazdan veriler tekrar okundu ve alanlar güncellendi.');
      } catch (e) {
        logMsg('Cihazdan veri okuma sırasında hata: ' + e);
      }
    });
  }
});

// Yaz butonuna basıldığında inputlarda eksik karakter varsa uyarı göster
const writeAllBtn = document.getElementById('write_all');
if (writeAllBtn) {
  writeAllBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const ide = document.getElementById('device_eui');
    const iae = document.getElementById('app_eui');
    const iak = document.getElementById('app_key');
    let valid = true;
    let msg = '';
    if (!ide.value || ide.value.length !== 16) {
      valid = false;
      msg += 'Device EUI alanı tam 16 karakter olmalı.\n';
    }
    if (!iae.value || iae.value.length !== 16) {
      valid = false;
      msg += 'APP EUI alanı tam 16 karakter olmalı.\n';
    }
    if (!iak.value || iak.value.length !== 32) {
      valid = false;
      msg += 'APP KEY alanı tam 32 karakter olmalı.';
    }
    if (!valid) {
      alert(msg);
      return;
    }
    // Bluetooth üzerinden gerekli bilgileri gönder
    writeAll();
  });
}

// Firmware dosyası seçme butonunu tetikle
const firmwareFileInput = document.getElementById('firmware-file');
const firmwareFileLabel = document.querySelector('.file-input-label');
const firmwareDetails = document.querySelector('.firmware-details');
const firmwareFilename = document.getElementById('firmware-filename');
const firmwareSize = document.getElementById('firmware-size');

if (firmwareFileLabel && firmwareFileInput) {
    firmwareFileLabel.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('Firmware dosyası seç butonuna tıklandı');
        firmwareFileInput.click();
    });
}

if (firmwareFileInput) {
    firmwareFileInput.addEventListener('change', function(e) {
        console.log('Firmware dosyası seçildi, event:', e);
        const file = e.target.files[0];
        if (!file) {
            console.log('Dosya seçilmedi.');
            return;
        }
        if (!file.name.endsWith('.bin')) {
            alert('Lütfen .bin uzantılı bir dosya seçin!');
            firmwareFileInput.value = '';
            firmwareDetails.style.display = 'none';
            console.log('Yanlış dosya uzantısı:', file.name);
            return;
        }
        firmwareFilename.textContent = file.name;
        firmwareSize.textContent = formatFileSize(file.size);
        firmwareDetails.style.display = 'block';
        
        // Dosya seçildikten sonra "Yüklemeyi Başlat" butonunu aktif et
        const startUploadBtn = document.getElementById('start-upload');
        if (startUploadBtn) {
            startUploadBtn.disabled = false;
        }
        
        console.log('Seçilen dosya:', file.name, file.size);
    });
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
}

// --- Otomatik Sürüm Kontrolü ---
const CURRENT_VERSION = document.querySelector('.app-version')?.textContent?.trim();
const GITHUB_IO_URL = "https://genieblocks.github.io/GenieBlocks_EnergyAnalyzer_Web_Bluetooth_Device_Configuration/";

function checkForNewVersion() {
  fetch(GITHUB_IO_URL, { cache: "no-store" })
    .then(response => response.text())
    .then(html => {
      // Yayındaki HTML'den versiyon numarasını çek
      const match = html.match(/<div class="app-version">v([0-9.]+)<\/div>/);
      if (match && match[1] && ("v" + match[1]) !== CURRENT_VERSION) {
        showUpdateModal("Yeni sürüm yayınlandı! Sayfayı yenilemek için Tamam'a tıklayın.");
      }
    })
    .catch(() => { /* Sessizce geç */ });
}

// Basit bir modal/popup fonksiyonu
function showUpdateModal(msg) {
  if (document.getElementById('update-modal')) return; // Tekrarlı gösterme
  const modal = document.createElement('div');
  modal.id = 'update-modal';
  modal.style = `
    position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;
    background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;`;
  modal.innerHTML = `
    <div style="background:#fff;padding:32px 24px;border-radius:12px;box-shadow:0 2px 12px #0002;text-align:center;">
      <div style="font-size:1.2em;margin-bottom:18px;">${msg}</div>
      <button id="update-ok" style="padding:8px 24px;font-size:1em;border-radius:8px;background:#00a7e9;color:#fff;border:none;cursor:pointer;">Tamam</button>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('update-ok').onclick = () => {
    location.reload();
  };
}

// 10 saniyede bir kontrol et
setInterval(checkForNewVersion, 10000);

// Tab değişimi için event listener'ları ekle
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-modern').forEach(btn => {
        btn.addEventListener('click', function() {
            // Aktif tab'ı değiştir
            document.querySelectorAll('.tab-modern').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // Tab içeriğini göster/gizle
            document.querySelectorAll('.tab-pane').forEach(tc => tc.classList.remove('active'));
            document.getElementById('tab-' + this.dataset.tab).classList.add('active');

            // Firmware tabı aktifse input'u enable yap, değilse disable
            if (this.dataset.tab === 'firmware') {
                firmwareFileInput.removeAttribute('disabled');
            } else {
                firmwareFileInput.setAttribute('disabled', 'disabled');
            }
        });
    });

    // Sayfa ilk açıldığında da kontrol et
    const activeTab = document.querySelector('.tab-modern.active');
    if (activeTab && activeTab.dataset.tab === 'firmware') {
        firmwareFileInput.removeAttribute('disabled');
    } else {
        firmwareFileInput.setAttribute('disabled', 'disabled');
    }
});

// Firmware güncelleme için BLE bağlantı kontrolü
function checkFirmwareConnection() {
    if (!device) {
        addFirmwareLog('Hata: Cihaza bağlı değil! Önce cihaza bağlanın.', 'error');
        return false;
    }
    
    if (!device.gatt || !device.gatt.connected) {
        addFirmwareLog('Hata: Bluetooth bağlantısı kopuk! Lütfen tekrar bağlanın.', 'error');
        return false;
    }
    
    addFirmwareLog('Bağlantı kontrolü başarılı.', 'success');
    return true;
}

// Firmware yükleme sırasında input ve butonları yönet
function setFirmwareUiBusy(isBusy) {
    // Dosya inputu ve label
    firmwareFileInput.disabled = isBusy;
    document.querySelector('.file-input-label').classList.toggle('disabled', isBusy);

    // Butonlar
    document.getElementById('start-upload').disabled = isBusy;
    document.getElementById('cancel-upload').disabled = !isBusy;
}

// Log ve progress bar'ı otomatik en alta kaydır
function scrollFirmwareLogToBottom() {
    const logContent = document.getElementById('firmware-log-content');
    if (logContent) logContent.scrollTop = logContent.scrollHeight;
}

// Kısa süreli görsel bildirim (arka plan animasyonu)
function flashFirmwareLogBg(type) {
    const logContent = document.getElementById('firmware-log-content');
    if (!logContent) return;
    let color = type === 'success' ? '#d2f8e5' : type === 'error' ? '#ffeaea' : '#f8f9fa';
    logContent.style.transition = 'background 0.4s';
    logContent.style.background = color;
    setTimeout(() => {
        logContent.style.background = '#f8f9fa';
    }, 700);
}

// Firmware log sistemi
function addFirmwareLog(message, type = 'info') {
    const logContent = document.getElementById('firmware-log-content');
    if (!logContent) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const typeClass = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
    const logEntry = `<div class="log-entry ${typeClass}">[${timestamp}] ${message}</div>`;
    
    logContent.innerHTML += logEntry;
    scrollFirmwareLogToBottom();
    if (type === 'success' || type === 'error') flashFirmwareLogBg(type);
}

// Firmware progress bar güncelleme
function updateFirmwareProgress(percentage) {
    const progressBar = document.querySelector('.progress');
    const progressText = document.querySelector('.progress-text');
    const progressContainer = document.querySelector('.progress-container');
    
    if (progressBar && progressText && progressContainer) {
        progressBar.style.width = percentage + '%';
        progressText.textContent = '%' + percentage;
        
        if (percentage > 0 && progressContainer.style.display === 'none') {
            progressContainer.style.display = 'block';
        }
    }
}

// Firmware butonları için event listener'lar
document.addEventListener('DOMContentLoaded', () => {
    const startUploadBtn = document.getElementById('start-upload');
    const cancelUploadBtn = document.getElementById('cancel-upload');
    const clearLogBtn = document.getElementById('clear-firmware-log');
    
    if (startUploadBtn) {
        startUploadBtn.addEventListener('click', startFirmwareUpload);
    }
    
    if (cancelUploadBtn) {
        cancelUploadBtn.addEventListener('click', cancelFirmwareUpload);
    }
    
    if (clearLogBtn) {
        clearLogBtn.addEventListener('click', clearFirmwareLog);
    }
});



// Firmware upload işlemi sırasında iptal kontrolü için global değişken
let firmwareUploadCancelled = false;

// Firmware upload iptal etme
function cancelFirmwareUpload() {
    firmwareUploadCancelled = true;
    addFirmwareLog('Firmware güncelleme iptal edildi. Cihaza CANCEL komutu gönderiliyor...', 'info');
    // Eğer commandChar erişimi varsa CANCEL komutu gönder
    if (window._otaCommandChar) {
        sendOtaCommandNimbleOta('CANCEL', window._otaCommandChar)
            .then(() => addFirmwareLog('CANCEL komutu gönderildi.', 'info'))
            .catch(() => addFirmwareLog('CANCEL komutu gönderilemedi.', 'error'));
    }
    // Cihaza restart komutu gönder
    sendDeviceRestartCommand();
    updateFirmwareProgress(0);
    setFirmwareUiBusy(false);
    stopFirmwareTimer();
}

// Cihaza restart komutu gönderen fonksiyon
async function sendDeviceRestartCommand() {
    try {
        if (!device || !device.gatt.connected) {
            addFirmwareLog('Cihaz bağlı değil, restart komutu gönderilemedi.', 'error');
            return;
        }
        const server = device.gatt;
        let service = await server.getPrimaryService(SYSTEM_SERVICE_UUID);
        let characteristic = await service.getCharacteristic(COMMIT_CHAR_UUID);
        await characteristic.writeValue(Uint8Array.of(0x01));
        addFirmwareLog('Cihaza restart komutu gönderildi.', 'info');
    } catch (err) {
        addFirmwareLog('Cihaza restart komutu gönderilemedi: ' + err.message, 'error');
    }
}

// NimBLEOta protokolüne uygun firmware upload fonksiyonu
async function startFirmwareUpload() {
    addFirmwareLog('Firmware güncelleme başlatılıyor...', 'info');
    firmwareUploadCancelled = false;
    setFirmwareUiBusy(true);
    startFirmwareTimer();

    if (!checkFirmwareConnection()) {
        setFirmwareUiBusy(false);
        return;
    }

    const file = firmwareFileInput.files[0];
    if (!file) {
        addFirmwareLog('Hata: Lütfen önce bir firmware dosyası seçin!', 'error');
        setFirmwareUiBusy(false);
        return;
    }

    addFirmwareLog(`Seçilen dosya: ${file.name} (${formatFileSize(file.size)})`, 'info');
    updateFirmwareProgress(0);

    try {
        const server = device.gatt;
        addFirmwareLog('GATT server bağlantısı kuruldu.', 'info');
        
        // Tüm servisleri listele (debug için)
        const services = await server.getPrimaryServices();
        addFirmwareLog(`Bulunan servis sayısı: ${services.length}`, 'info');
        for (let i = 0; i < services.length; i++) {
            const service = services[i];
            addFirmwareLog(`Servis ${i + 1}: ${service.uuid}`, 'info');
        }
        
        // OTA servisini al
        addFirmwareLog(`OTA servisi aranıyor: ${OTA_SERVICE_UUID}`, 'info');
        const otaService = await server.getPrimaryService(OTA_SERVICE_UUID);
        addFirmwareLog('OTA servisi bulundu.', 'success');
        
        // OTA servisindeki tüm karakteristikleri listele (debug için)
        const characteristics = await otaService.getCharacteristics();
        addFirmwareLog(`OTA servisindeki karakteristik sayısı: ${characteristics.length}`, 'info');
        
        // Karakteristikleri UUID'lerine göre grupla
        const charMap = {};
        for (let i = 0; i < characteristics.length; i++) {
            const char = characteristics[i];
            const uuid = char.uuid;
            charMap[uuid] = char;
            
            // properties bir object, array değil
            const properties = [];
            if (char.properties.read) properties.push('read');
            if (char.properties.write) properties.push('write');
            if (char.properties.writeWithoutResponse) properties.push('writeWithoutResponse');
            if (char.properties.notify) properties.push('notify');
            if (char.properties.indicate) properties.push('indicate');
            
            addFirmwareLog(`Karakteristik ${i + 1}: ${uuid} (${properties.join(', ')})`, 'info');
        }
        
        // Beklenen UUID'leri kontrol et (Python ile aynı)
        const expectedUuids = {
            'firmware': OTA_RECV_CHARACTERISTIC_UUID,
            'command': OTA_COMMAND_CHARACTERISTIC_UUID
        };
        
        addFirmwareLog('Beklenen UUID\'ler:', 'info');
        for (const [name, uuid] of Object.entries(expectedUuids)) {
            addFirmwareLog(`  ${name}: ${uuid}`, 'info');
        }
        
        // Karakteristikleri al (hata yönetimi ile)
        let firmwareChar, progressChar, commandChar;
        
        try {
            addFirmwareLog(`Firmware karakteristiği aranıyor: ${OTA_RECV_CHARACTERISTIC_UUID}`, 'info');
            firmwareChar = await otaService.getCharacteristic(OTA_RECV_CHARACTERISTIC_UUID);
            addFirmwareLog('Firmware karakteristiği bulundu.', 'success');
        } catch (error) {
            addFirmwareLog(`Firmware karakteristiği bulunamadı: ${error.message}`, 'error');
            throw error;
        }
        

        
        try {
            addFirmwareLog(`Command karakteristiği aranıyor: ${OTA_COMMAND_CHARACTERISTIC_UUID}`, 'info');
            commandChar = await otaService.getCharacteristic(OTA_COMMAND_CHARACTERISTIC_UUID);
            addFirmwareLog('Command karakteristiği bulundu.', 'success');
        } catch (error) {
            addFirmwareLog(`Command karakteristiği bulunamadı: ${error.message}`, 'error');
            throw error;
        }

        window._otaCommandChar = commandChar;

        addFirmwareLog('Tüm OTA karakteristikleri başarıyla bulundu.', 'success');

        // Notification queue'ları oluştur
        let cmdQueue = [];
        let fwQueue = [];

        // Command characteristic notification listener
        commandChar.addEventListener('characteristicvaluechanged', (event) => {
            const value = event.target.value;
            // DÜZELTME: DataView'ın offset ve length'ini kullan!
            const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            // addFirmwareLog('Command notification geldi: ' + Array.from(data).map(x=>x.toString(16).padStart(2,'0')).join(' '), 'info');
            cmdQueue.push(data);
        });

        // Firmware characteristic notification listener (Python ile aynı - progress karakteristiği yok)
        firmwareChar.addEventListener('characteristicvaluechanged', (event) => {
            const value = event.target.value;
            // DÜZELTME: DataView'ın offset ve length'ini kullan!
            const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            // addFirmwareLog('Firmware notification geldi: ' + Array.from(data).map(x=>x.toString(16).padStart(2,'0')).join(' '), 'info');
            // const parsed = parseFirmwareNotification(data);
            // addFirmwareLog('Firmware notification parse: ' + JSON.stringify(parsed), 'info');
            fwQueue.push(data);
        });

        // ÖNCE notification'ları başlat (Python ile aynı sıra)
        addFirmwareLog('Command notification başlatılıyor...', 'info');
        await commandChar.startNotifications();
        // addFirmwareLog('Command notification başlatıldı.', 'info');
        
        addFirmwareLog('Firmware notification başlatılıyor...', 'info');
        await firmwareChar.startNotifications();
        // addFirmwareLog('Firmware notification başlatıldı.', 'info');

        // SONRA START komutu gönder ve ACK bekle (Python ile aynı mantık)
        await sendOtaCommandNimbleOta('START', commandChar, file.size);
        
        let startAck;
        for (let i = 0; i < 10; i++) {
            if (cmdQueue.length > 0) {
                const raw = cmdQueue.shift();
                const parsed = parseCommandNotification(raw);
                addFirmwareLog('ACK parse: ' + JSON.stringify(parsed), 'info');
                startAck = parsed;
                break;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        if (!startAck || !startAck.valid) throw new Error("START komutu için geçerli ACK alınamadı!");
        if (startAck.rsp !== 0x0000) throw new Error("START komutu reddedildi: " + otaStatusText(startAck.rsp));
        
        addFirmwareLog('START komutu onaylandı.', 'success');

        // Firmware dosyasını oku ve sektörlere böl
        const arrayBuffer = await file.arrayBuffer();
        const sectors = splitFirmwareToSectors(arrayBuffer, 4096);
        addFirmwareLog(`Toplam sektör sayısı: ${sectors.length}`, 'info');

        // Her sektör için CRC hesapla ve sektörün sonuna ekle (Python ile aynı)
        for (let i = 0; i < sectors.length; i++) {
            const sector = sectors[i];
            const sectorArray = new Uint8Array(sector);
            const crc = crc16ccitt(0, sectorArray, sectorArray.length);
            addFirmwareLog(`Sektör #${i + 1} CRC: 0x${crc.toString(16).toUpperCase()} (uzunluk: ${sectorArray.length})`, 'info');
            // CRC'yi sektörün sonuna ekle (2 byte - Python ile aynı)
            const sectorWithCrc = new Uint8Array(sectorArray.length + 2);
            sectorWithCrc.set(sectorArray);
            sectorWithCrc[sectorArray.length] = crc & 0xFF;
            sectorWithCrc[sectorArray.length + 1] = (crc >> 8) & 0xFF;
            sectors[i] = sectorWithCrc.buffer;
        }

        // Sektörleri gönder
        for (let secIdx = 0; secIdx < sectors.length; secIdx++) {
            if (firmwareUploadCancelled) {
                addFirmwareLog('Kullanıcı tarafından iptal edildi. İşlem durduruldu.', 'error');
                updateFirmwareProgress(0);
                setFirmwareUiBusy(false);
                stopFirmwareTimer();
                return;
            }

            const sector = sectors[secIdx];
            const sectorArray = new Uint8Array(sector);
            
            addFirmwareLog(`Sektör #${secIdx + 1} gönderiliyor... (${sectorArray.length} byte)`, 'info');

            // Sektörü chunk'lara böl (Python ile aynı mantık)
            const MAX_CHUNK_SIZE = 507; // React ile aynı
            const numChunks = Math.ceil(sectorArray.length / MAX_CHUNK_SIZE);
            
            for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
                const start = chunkIdx * MAX_CHUNK_SIZE;
                const end = Math.min(start + MAX_CHUNK_SIZE, sectorArray.length);
                const chunk = sectorArray.slice(start, end);
                
                // Son sektör için 0xFFFF, diğerleri için secIdx kullan
                const sectorIndex = (secIdx === sectors.length - 1) ? 0xFFFF : secIdx;
                // 3-byte header ekle: [sector_index_low, sector_index_high, chunk_sequence] (little-endian)
                const header = new Uint8Array(3);
                header[0] = sectorIndex & 0xFF; // low byte
                header[1] = (sectorIndex >> 8) & 0xFF; // high byte
                header[2] = (chunkIdx === numChunks - 1) ? 0xFF : chunkIdx;
                
                // Header + chunk'ı birleştir
                const packet = new Uint8Array(3 + chunk.length);
                packet.set(header);
                packet.set(chunk, 3);
                
                // addFirmwareLog(`Chunk ${chunkIdx + 1}/${numChunks} gönderiliyor... (${packet.length} byte)`, 'info');
                // addFirmwareLog(`Chunk veri (ilk 16 byte): ${Array.from(packet.slice(0, 16)).map(x=>x.toString(16).padStart(2,'0')).join(' ')}...`, 'info');
                await firmwareChar.writeValue(packet);
            }

            // ACK bekle (Python ile aynı mantık)
            let ack, rspSector;
            for (let i = 0; i < 20; i++) {
                if (fwQueue.length > 0) {
                    const fwAck = parseFirmwareNotification(fwQueue.shift());
                    ack = fwAck.status;
                    rspSector = fwAck.curSector;
                    break;
                }
                await new Promise(r => setTimeout(r, 200));
            }
            
            if (ack === 0x0000) { // FW_ACK_SUCCESS
                addFirmwareLog(`Sektör #${secIdx + 1} başarıyla gönderildi.`, 'success');
                updateFirmwareProgress(Math.round(((secIdx + 1) / sectors.length) * 100));
                
                if (secIdx === sectors.length - 1) {
                    addFirmwareLog('Tüm sektörler gönderildi.', 'success');
                }
            } else if (ack === 0x0001 || ack === 0x0003 || ack === 0xFFFF) { // FW_ACK_CRC_ERROR, FW_ACK_LEN_ERROR, RSP_CRC_ERROR
                const errorMsg = ack === 0x0003 ? 'Length Error' : 'CRC Error';
                addFirmwareLog(`${errorMsg} - Sektör #${secIdx + 1} tekrar deneniyor...`, 'error');
                secIdx--; // Aynı sektörü tekrar gönder
                continue;
            } else if (ack === 0x0002) { // FW_ACK_SECTOR_ERROR
                addFirmwareLog(`Sektör Hatası, sektör #${rspSector + 1} gönderiliyor...`, 'error');
                secIdx = rspSector - 1; // rspSector 1-based ise, secIdx 0-based yap
                continue;
            } else {
                addFirmwareLog(`Bilinmeyen hata: 0x${ack.toString(16).toUpperCase()}`, 'error');
                throw new Error(`Bilinmeyen hata: 0x${ack.toString(16).toUpperCase()}`);
            }
        }

        // END komutu gönder
        await sendOtaCommandNimbleOta('END', commandChar);
        addFirmwareLog('Firmware güncelleme tamamlandı!', 'success');
        updateFirmwareProgress(100);
        flashFirmwareLogBg('success');
        setFirmwareUiBusy(false);
        stopFirmwareTimer();
        
    } catch (err) {
        addFirmwareLog('Hata: ' + err.message, 'error');
        updateFirmwareProgress(0);
        flashFirmwareLogBg('error');
        setFirmwareUiBusy(false);
        stopFirmwareTimer();
    } finally {
        window._otaCommandChar = null;
    }
}

// Firmware log temizleme
function clearFirmwareLog() {
    const logContent = document.getElementById('firmware-log-content');
    if (logContent) {
        logContent.innerHTML = '';
        addFirmwareLog('Log temizlendi.', 'info');
    }
}

// 1. OTA servis ve karakteristik UUID'leri
const OTA_SERVICE_UUID = 0x8018;
const OTA_RECV_CHARACTERISTIC_UUID = 0x8020;
const OTA_PROGRESS_CHARACTERISTIC_UUID = 0x8021;
const OTA_COMMAND_CHARACTERISTIC_UUID = 0x8022;

// 2. NimBLEOta komut gönderme fonksiyonu (Python ile birebir aynı)
async function sendOtaCommandNimbleOta(type, commandChar, fileSize = 0) {
    let cmd = 0x0001; // START
    if (type === "END") cmd = 0x0002;
    if (type === "CANCEL") cmd = 0x0003;

    let buf = new Uint8Array(20);
    // Python: command[0:2] = START_COMMAND.to_bytes(2, byteorder='little')
    buf[0] = cmd & 0xFF;        // little endian - low byte first
    buf[1] = (cmd >> 8) & 0xFF; // little endian - high byte second
    
    if (type === "START") {
        // Python: command[2:6] = file_size.to_bytes(4, byteorder='little')
        buf[2] = fileSize & 0xFF;           // little endian - byte 0
        buf[3] = (fileSize >> 8) & 0xFF;    // little endian - byte 1
        buf[4] = (fileSize >> 16) & 0xFF;   // little endian - byte 2
        buf[5] = (fileSize >> 24) & 0xFF;   // little endian - byte 3
    }
    
    // Python: crc16 = crc16_ccitt(command[0:18])
    let crc = crc16ccitt(0, buf, 18);
    
    // Python: command[18:20] = crc16.to_bytes(2, byteorder='little')
    buf[18] = crc & 0xFF;        // little endian - low byte first
    buf[19] = (crc >> 8) & 0xFF; // little endian - high byte second

    await commandChar.writeValue(buf);
    addFirmwareLog(`Komut gönderildi: ${type} (CRC16-CCITT: 0x${crc.toString(16).toUpperCase()})`, 'info');
    
    // Debug: Komut buffer'ının içeriğini logla
    const debugHex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join(' ');
    addFirmwareLog(`Debug - Komut buffer: ${debugHex}`, 'info');
}

// 3. Firmware dosyasını 4KB sektörlere böl
function splitFirmwareToSectors(arrayBuffer, sectorSize = 4096) {
    const sectors = [];
    const total = arrayBuffer.byteLength;
    for (let i = 0; i < total; i += sectorSize) {
        sectors.push(arrayBuffer.slice(i, i + sectorSize));
    }
    return sectors;
}

// 4. NimBLEOta ile uyumlu CRC16-CCITT hesaplama fonksiyonu (BLEOTA ile birebir aynı)
function crc16ccitt(init, data, len) {
    let crc = init;
    for (let i = 0; i < len; i++) {
        crc ^= data[i] << 8;
        for (let j = 0; j < 8; j++) {
            if (crc & 0x8000) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return crc & 0xFFFF;
}

// Python ile aynı notification handler'ları
function parseFirmwareNotification(data) {
    // Python: fw_notification_handler
    if (data.length !== 20) return { valid: false };
    
    const sectorSent = (data[1] << 8) | data[0]; // little endian
    const status = (data[3] << 8) | data[2];
    const curSector = (data[5] << 8) | data[4];
    const crc = (data[19] << 8) | data[18];
    
    const calcCrc = crc16ccitt(0, data, 18);
    const isValid = crc === calcCrc;
    
    return {
        valid: isValid,
        sectorSent,
        status: isValid ? status : 0xFFFF, // RSP_CRC_ERROR
        curSector,
        crc,
        calcCrc
    };
}

function parseCommandNotification(data) {
    // Python: cmd_notification_handler
    if (data.length !== 20) return { valid: false };
    
    const ack = (data[1] << 8) | data[0];
    const cmd = (data[3] << 8) | data[2];
    const rsp = (data[5] << 8) | data[4];
    const crc = (data[19] << 8) | data[18];
    
    const calcCrc = crc16ccitt(0, data, 18);
    const isValid = crc === calcCrc;
    
    return {
        valid: isValid,
        ack,
        cmd,
        rsp: isValid ? rsp : 0xFFFF, // RSP_CRC_ERROR
        crc,
        calcCrc
    };
}

// Hata kodu açıklamaları
function otaStatusText(status) {
    switch (status) {
        case 0x0000: return 'Başarılı';
        case 0x0001: return 'CRC Hatası';
        case 0x0002: return 'Sektör Hatası';
        case 0x0003: return 'Uzunluk Hatası';
        case 0xFFFF: return 'CRC Kontrol Hatası (Notification)';
        default: return 'Bilinmeyen Hata';
    }
}

let firmwareUploadTimer = null;
let firmwareUploadStartTime = null;

function startFirmwareTimer() {
    firmwareUploadStartTime = Date.now();
    const timerValue = document.getElementById('firmware-timer-value');
    if (firmwareUploadTimer) clearInterval(firmwareUploadTimer);
    timerValue.textContent = '00:00';
    firmwareUploadTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - firmwareUploadStartTime) / 1000);
        const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const sec = String(elapsed % 60).padStart(2, '0');
        timerValue.textContent = `${min}:${sec}`;
    }, 1000);
}

function stopFirmwareTimer() {
    if (firmwareUploadTimer) {
        clearInterval(firmwareUploadTimer);
        firmwareUploadTimer = null;
    }
}
