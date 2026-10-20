import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const requireFromApp = createRequire(process.cwd() + '/package.json');
const JSZip = requireFromApp('jszip');
const { DOMParser } = requireFromApp('@xmldom/xmldom');

const app = fs.readFileSync('public/app.js', 'utf8');
assert.ok(app.includes('YOURZ_XLSX_INLINE_IMAGE_PREVIEW_V1'), 'XLSX image preview marker must be present');
assert.ok(app.includes('xlsx-cell-image'), 'Rendered workbook cells must support embedded image elements');

const functionStart = app.indexOf('async function parseXlsxPreview(blob){');
const functionEnd = app.indexOf('\n /* YOURZ PRODUCT FILE LIBRARY V1 HELPERS */', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'Could not isolate XLSX preview function');
const functionSource = app.slice(functionStart, functionEnd).trim();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
})[char]);

const objectUrls = new Map();
let urlCounter = 0;
const URLStub = {
  createObjectURL(blob) {
    const url = 'blob:xlsx-preview-' + (++urlCounter);
    objectUrls.set(url, blob);
    return url;
  },
  revokeObjectURL(url) { objectUrls.delete(url); }
};
const windowStub = { JSZip, __yourzXlsxPreviewUrls: [] };
const buildParser = new Function('window', 'JSZip', 'DOMParser', 'URL', 'Blob', 'esc', 'return (' + functionSource + ');');
const parseXlsxPreview = buildParser(windowStub, JSZip, DOMParser, URLStub, Blob, escapeHtml);

const zip = new JSZip();
const mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pkgNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const pictureNs = 'http://schemas.openxmlformats.org/drawingml/2006/main';

zip.file('xl/workbook.xml',
  '<workbook xmlns="' + mainNs + '" xmlns:r="' + relNs + '"><sheets><sheet name="Quote" sheetId="1" r:id="rIdSheet1"/></sheets></workbook>');
zip.file('xl/_rels/workbook.xml.rels',
  '<Relationships xmlns="' + pkgNs + '"><Relationship Id="rIdSheet1" Type="' + relNs + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
zip.file('xl/worksheets/sheet1.xml',
  '<worksheet xmlns="' + mainNs + '" xmlns:r="' + relNs + '"><sheetData>' +
  '<row r="1"><c r="A1" t="inlineStr"><is><t>货号</t></is></c><c r="B1" t="inlineStr"><is><t>单价</t></is></c></row>' +
  '<row r="3"><c r="A3" t="inlineStr"><is><t>ZX-TEST-001</t></is></c><c r="B3"><v>12.50</v></c></row>' +
  '<row r="4"><c r="A4" t="inlineStr"><is><t>ZX-TEST-002</t></is></c><c r="B4"><v>8.30</v></c></row>' +
  '</sheetData><drawing r:id="rIdDrawing1"/></worksheet>');
zip.file('xl/worksheets/_rels/sheet1.xml.rels',
  '<Relationships xmlns="' + pkgNs + '"><Relationship Id="rIdDrawing1" Type="' + relNs + '/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
zip.file('xl/drawings/drawing1.xml',
  '<xdr:wsDr xmlns:xdr="' + drawingNs + '" xmlns:a="' + pictureNs + '" xmlns:r="' + relNs + '">' +
  '<xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
  '<xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
  '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Picture 1"/><xdr:cNvPicPr/></xdr:nvPicPr>' +
  '<xdr:blipFill><a:blip r:embed="rIdImg1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
  '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>' +
  '<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>');
zip.file('xl/drawings/_rels/drawing1.xml.rels',
  '<Relationships xmlns="' + pkgNs + '"><Relationship Id="rIdImg1" Type="' + relNs + '/image" Target="../media/image1.png"/></Relationships>');
zip.file('xl/media/image1.png', Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]));

const workbookBlob = await zip.generateAsync({ type: 'blob' });
const html = await parseXlsxPreview(workbookBlob);
assert.ok(html.includes('ZX-TEST-001'), 'Product code must be present in preview');
assert.ok(html.includes('12.50'), 'Price must be present in preview');
assert.ok(html.includes('ZX-TEST-002'), 'A second row must remain visible');
const rowWithImage = html.split('<tr>').find(row => row.includes('ZX-TEST-001'));
const rowWithoutImage = html.split('<tr>').find(row => row.includes('ZX-TEST-002'));
assert.ok(rowWithImage?.includes('xlsx-cell-image'), 'Embedded picture must appear on its anchored product row');
assert.ok(!rowWithoutImage?.includes('xlsx-cell-image'), 'Embedded picture must not spill into another product row');
assert.equal((html.match(/class="xlsx-cell-image"/g) || []).length, 1, 'Only the workbook’s one embedded picture should be rendered');
assert.equal(windowStub.__yourzXlsxPreviewUrls.length, 1, 'Preview image URL must be tracked for cleanup');
assert.equal(objectUrls.get(windowStub.__yourzXlsxPreviewUrls[0])?.type, 'image/png', 'Image MIME type must be preserved');
console.log('PASS: XLSX preview retains product values and prices and renders an embedded image at the correct cell anchor.');
