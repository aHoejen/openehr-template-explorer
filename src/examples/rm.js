// Small builders for abridged openEHR canonical JSON, used by the teaching examples.
//
// Any object can carry a `_link` marker (string or array of link ids). The example
// view strips the markers and records the JSON pointer of each marked object, so a
// mapping row can highlight the matching part of the openEHR and FHIR JSON.

export const text = (value) => ({ _type: "DV_TEXT", value });

export const codePhrase = (terminology, code) => ({
  _type: "CODE_PHRASE",
  terminology_id: { _type: "TERMINOLOGY_ID", value: terminology },
  code_string: code,
});

/** DV_CODED_TEXT; `mappings` is a list of [terminology, code] pairs recorded as TERM_MAPPINGs. */
export function coded(value, terminology, code, mappings) {
  const dv = { _type: "DV_CODED_TEXT", value, defining_code: codePhrase(terminology, code) };
  if (mappings?.length) {
    dv.mappings = mappings.map(([t, c]) => ({ _type: "TERM_MAPPING", match: "=", target: codePhrase(t, c) }));
  }
  return dv;
}

export const quantity = (magnitude, units) => ({ _type: "DV_QUANTITY", magnitude, units });
export const proportion = (numerator, denominator, type) => ({ _type: "DV_PROPORTION", numerator, denominator, type });
export const dateTime = (value) => ({ _type: "DV_DATE_TIME", value });

export function element(nodeId, name, value, link) {
  const el = { _type: "ELEMENT", name: text(name), archetype_node_id: nodeId, value };
  if (link) el._link = link;
  return el;
}

export const tree = (nodeId, name, items) => ({ _type: "ITEM_TREE", name: text(name), archetype_node_id: nodeId, items });
export const cluster = (archetypeId, name, items, link) => ({
  _type: "CLUSTER",
  name: text(name),
  archetype_node_id: archetypeId,
  items,
  ...(link ? { _link: link } : {}),
});

/** OBSERVATION with one POINT_EVENT. */
export function observation({ archetypeId, name, link, historyId, historyName, eventId, eventName, time, dataId, dataName, data, stateId, stateName, state, protocolId, protocolName, protocol }) {
  const event = { _type: "POINT_EVENT", name: text(eventName), archetype_node_id: eventId, time: dateTime(time), data: tree(dataId, dataName, data) };
  if (state) event.state = tree(stateId, stateName, state);
  const obs = {
    _type: "OBSERVATION",
    name: text(name),
    archetype_node_id: archetypeId,
    subject: { _type: "PARTY_SELF" },
    data: { _type: "HISTORY", name: text(historyName), archetype_node_id: historyId, origin: dateTime(time), events: [event] },
  };
  if (protocol) obs.protocol = tree(protocolId, protocolName, protocol);
  if (link) obs._link = link;
  return obs;
}

export function evaluation({ archetypeId, name, link, dataId, dataName, data, subjectLink }) {
  const subject = { _type: "PARTY_SELF" };
  if (subjectLink) subject._link = subjectLink;
  const ev = { _type: "EVALUATION", name: text(name), archetype_node_id: archetypeId, subject, data: tree(dataId, dataName, data) };
  if (link) ev._link = link;
  return ev;
}

// FHIR helpers
export const SCT = "http://snomed.info/sct";
export const LOINC = "http://loinc.org";
export const UCUM = "http://unitsofmeasure.org";
export const coding = (system, code, display) => ({ system, code, display });
export const fhirQuantity = (value, unit, code = unit) => ({ value, unit, system: UCUM, code });
export const VITAL_SIGNS_CATEGORY = [
  { coding: [coding("http://terminology.hl7.org/CodeSystem/observation-category", "vital-signs", "Vital Signs")] },
];
