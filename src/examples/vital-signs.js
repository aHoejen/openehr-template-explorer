import {
  observation, element, coded, quantity, proportion, text,
  SCT, LOINC, coding, fhirQuantity, VITAL_SIGNS_CATEGORY,
} from "./rm.js";

const T = "2026-11-18T09:30:00+01:00";
const PATIENT = { reference: "Patient/example" };
const BP = "openEHR-EHR-OBSERVATION.blood_pressure.v2";
const PULSE = "openEHR-EHR-OBSERVATION.pulse.v2";
const RESP = "openEHR-EHR-OBSERVATION.respiration.v2";
const TEMP = "openEHR-EHR-OBSERVATION.body_temperature.v2";
const SPO2 = "openEHR-EHR-OBSERVATION.pulse_oximetry.v1";

const openehr = {
  _type: "COMPOSITION",
  name: text("Vital signs monitoring"),
  archetype_node_id: "openEHR-EHR-COMPOSITION.vital_signs_monitoring.v1",
  archetype_details: { template_id: { value: "Vital signs monitoring" } },
  context: { start_time: { _type: "DV_DATE_TIME", value: T } },
  content: [
    observation({
      archetypeId: BP, name: "Blood pressure", link: "bp",
      historyId: "at0001", historyName: "History", eventId: "at0006", eventName: "Any event", time: T,
      dataId: "at0003", dataName: "blood pressure",
      data: [
        element("at0004", "Systolic", quantity(148, "mm[Hg]"), "bp-sys"),
        element("at0005", "Diastolic", quantity(92, "mm[Hg]"), "bp-dia"),
      ],
      stateId: "at0007", stateName: "state structure",
      state: [element("at0008", "Position", coded("Sitting", "local", "at1001", [["SNOMED-CT", "33586001"]]), "bp-position")],
      protocolId: "at0011", protocolName: "Tree",
      protocol: [
        element("at0013", "Cuff size", coded("Adult", "local", "at0017"), "bp-cuff"),
        element("at0014", "Location of measurement", coded("Right arm", "local", "at0025"), "bp-site"),
      ],
    }),
    observation({
      archetypeId: PULSE, name: "Pulse/Heart beat",
      historyId: "at0002", historyName: "history", eventId: "at0003", eventName: "Any event", time: T,
      dataId: "at0001", dataName: "structure",
      data: [element("at0004", "Rate", quantity(78, "/min"), "pulse-rate")],
    }),
    observation({
      archetypeId: RESP, name: "Respiration",
      historyId: "at0001", historyName: "history", eventId: "at0002", eventName: "Any event", time: T,
      dataId: "at0003", dataName: "List",
      data: [element("at0004", "Rate", quantity(16, "/min"), "resp-rate")],
    }),
    observation({
      archetypeId: TEMP, name: "Body temperature",
      historyId: "at0002", historyName: "History", eventId: "at0003", eventName: "Any event", time: T,
      dataId: "at0001", dataName: "Tree",
      data: [element("at0004", "Temperature", quantity(37.1, "Cel"), "temp")],
      protocolId: "at0020", protocolName: "Protocol",
      protocol: [element("at0021", "Location of measurement", coded("Axilla", "local", "at0024"), "temp-site")],
    }),
    observation({
      archetypeId: SPO2, name: "Pulse oximetry",
      historyId: "at0001", historyName: "Event Series", eventId: "at0002", eventName: "Any event", time: T,
      dataId: "at0003", dataName: "Tree",
      data: [element("at0006", "SpO₂", proportion(97, 100, 2), "spo2")],
    }),
  ],
};

const vitals = (profile, fhirCode, extra) => ({
  resourceType: "Observation",
  meta: { profile: [`http://hl7.org/fhir/StructureDefinition/${profile}`] },
  status: "final",
  category: VITAL_SIGNS_CATEGORY,
  code: fhirCode,
  subject: PATIENT,
  effectiveDateTime: T,
  ...extra,
});

const fhir = {
  resourceType: "Bundle",
  type: "collection",
  entry: [
    {
      fullUrl: "urn:uuid:7d1c2a40-0b8a-4f0e-9a7e-000000000001",
      resource: vitals(
        "bp",
        { coding: [coding(LOINC, "85354-9", "Blood pressure panel with all children optional"), coding(SCT, "364090009", "Systemic arterial pressure")], _link: "bp" },
        {
          extension: [
            {
              url: "http://hl7.org/fhir/StructureDefinition/observation-bodyPosition",
              valueCodeableConcept: { coding: [coding(SCT, "33586001", "Sitting position")] },
              _link: "bp-position",
            },
          ],
          bodySite: { coding: [coding(SCT, "368209003", "Right upper arm structure")], text: "Right arm", _link: "bp-site" },
          component: [
            {
              code: { coding: [coding(LOINC, "8480-6", "Systolic blood pressure"), coding(SCT, "271649006", "Systolic blood pressure")] },
              valueQuantity: fhirQuantity(148, "mmHg", "mm[Hg]"),
              _link: "bp-sys",
            },
            {
              code: { coding: [coding(LOINC, "8462-4", "Diastolic blood pressure"), coding(SCT, "271650006", "Diastolic blood pressure")] },
              valueQuantity: fhirQuantity(92, "mmHg", "mm[Hg]"),
              _link: "bp-dia",
            },
          ],
        },
      ),
    },
    {
      fullUrl: "urn:uuid:7d1c2a40-0b8a-4f0e-9a7e-000000000002",
      resource: vitals("heartrate", { coding: [coding(LOINC, "8867-4", "Heart rate"), coding(SCT, "364075005", "Heart rate")], _link: "pulse-rate" }, {
        valueQuantity: { ...fhirQuantity(78, "beats/minute", "/min"), _link: "pulse-rate" },
      }),
    },
    {
      fullUrl: "urn:uuid:7d1c2a40-0b8a-4f0e-9a7e-000000000003",
      resource: vitals("resprate", { coding: [coding(LOINC, "9279-1", "Respiratory rate"), coding(SCT, "271625008", "Rate of spontaneous respiration")], _link: "resp-rate" }, {
        valueQuantity: { ...fhirQuantity(16, "breaths/minute", "/min"), _link: "resp-rate" },
      }),
    },
    {
      fullUrl: "urn:uuid:7d1c2a40-0b8a-4f0e-9a7e-000000000004",
      resource: vitals("bodytemp", { coding: [coding(LOINC, "8310-5", "Body temperature"), coding(SCT, "386725007", "Body temperature")], _link: "temp" }, {
        valueQuantity: { ...fhirQuantity(37.1, "C", "Cel"), _link: "temp" },
        bodySite: { coding: [coding(SCT, "91470000", "Axillary region structure")], text: "Axilla", _link: "temp-site" },
      }),
    },
    {
      fullUrl: "urn:uuid:7d1c2a40-0b8a-4f0e-9a7e-000000000005",
      resource: vitals(
        "oxygensat",
        {
          coding: [
            coding(LOINC, "2708-6", "Oxygen saturation in Arterial blood"),
            coding(LOINC, "59408-5", "Oxygen saturation in Arterial blood by Pulse oximetry"),
            coding(SCT, "431314004", "Peripheral oxygen saturation"),
          ],
          _link: "spo2",
        },
        { valueQuantity: { ...fhirQuantity(97, "%"), _link: "spo2" } },
      ),
    },
  ],
};

// How each data item travels. `how` values are explained in the legend (examples-view.js).
const links = [
  {
    id: "bp", fhirBinding: {"strength": "required-coding", "name": "The FHIR R4 bp profile requires a coding with system http://loinc.org and code 85354-9", "slice": "Observation.code.coding:BPCode", "url": "https://hl7.org/fhir/R4/bp.html"}, group: "Blood pressure", label: "Blood pressure (the whole observation)",
    openehr: { archetype: BP, path: "/" }, value: "OBSERVATION blood_pressure.v2",
    terms: [
      { system: "SNOMED CT", code: "364090009", display: "Systemic arterial pressure", source: "archetype binding" },
      { system: "LOINC", code: "85354-9", display: "Blood pressure panel with all children optional", source: "FHIR profile" },
    ],
    fhir: "Observation.code", how: "bound",
    note: "The archetype binds the whole observation to SNOMED CT (written SNOMED-CT(2003) in the file). FHIR's vital-signs profile also requires the LOINC panel code, which is not in the archetype. The mapping has to add it.",
  },
  {
    id: "bp-sys", fhirBinding: {"strength": "required-coding", "name": "The FHIR R4 bp profile requires a coding with system http://loinc.org and code 8480-6", "slice": "Observation.component:SystolicBP.code.coding:SBPCode", "url": "https://hl7.org/fhir/R4/bp.html"}, group: "Blood pressure", label: "Systolic",
    openehr: { archetype: BP, path: "/data[at0001]/events[at0006]/data[at0003]/items[at0004]" }, value: "148 mm[Hg]",
    terms: [
      { system: "SNOMED CT", code: "271649006", display: "Systolic blood pressure", source: "archetype binding" },
      { system: "LOINC", code: "8480-6", display: "Systolic blood pressure", source: "FHIR profile" },
    ],
    fhir: "Observation.component[0]", how: "bound",
    note: "Same meaning in both: the SNOMED CT binding on at0004 becomes a coding on the component. Both standards use UCUM units, so mm[Hg] needs no conversion. The 2003 version stamp is dropped: FHIR identifies SNOMED CT by the system http://snomed.info/sct.",
  },
  {
    id: "bp-dia", fhirBinding: {"strength": "required-coding", "name": "The FHIR R4 bp profile requires a coding with system http://loinc.org and code 8462-4", "slice": "Observation.component:DiastolicBP.code.coding:DBPCode", "url": "https://hl7.org/fhir/R4/bp.html"}, group: "Blood pressure", label: "Diastolic",
    openehr: { archetype: BP, path: "/data[at0001]/events[at0006]/data[at0003]/items[at0005]" }, value: "92 mm[Hg]",
    terms: [
      { system: "SNOMED CT", code: "271650006", display: "Diastolic blood pressure", source: "archetype binding" },
      { system: "LOINC", code: "8462-4", display: "Diastolic blood pressure", source: "FHIR profile" },
    ],
    fhir: "Observation.component[1]", how: "bound",
  },
  {
    id: "bp-position", fhirBinding: {"strength": "none", "name": "The observation-bodyPosition extension has no terminology binding: any code system is allowed", "url": "https://hl7.org/fhir/extensions/StructureDefinition-observation-bodyPosition.html"}, group: "Blood pressure", label: "Position",
    openehr: { archetype: BP, path: "/data[at0001]/events[at0006]/state[at0007]/items[at0008]", localCode: "at1001" }, value: "Sitting (local at1001)",
    terms: [{ system: "SNOMED CT", code: "33586001", display: "Sitting position", source: "mapping" }],
    fhir: "Observation.extension (bodyPosition)", how: "mapped",
    note: "Blood pressure's position list uses local codes only, with no bindings. FHIR does not force a code system here: the bodyPosition extension has no binding. But 'at1001' means nothing outside the archetype, so a shared code is needed for the receiver to understand it, and SNOMED CT is the natural choice. Here the recording system stores that choice with the data as a TERM_MAPPING. The respiration archetype binds its own 'Sitting' to the same concept.",
  },
  {
    id: "bp-site", fhirBinding: {"strength": "example", "name": "Observation.bodySite: SNOMED CT body structures are given only as an example (body-site value set)", "url": "https://hl7.org/fhir/R4/valueset-body-site.html"}, group: "Blood pressure", label: "Location of measurement",
    openehr: { archetype: BP, path: "/protocol[at0011]/items[at0014]", localCode: "at0025" }, value: "Right arm (local at0025)",
    terms: [{ system: "SNOMED CT", code: "368209003", display: "Right upper arm structure", source: "mapping" }],
    fhir: "Observation.bodySite", how: "mapped",
    note: "Local code again, so the mapping decides. FHIR only offers SNOMED CT body structures as an example for bodySite, not a rule. 'Right arm' becomes 'Right upper arm structure': a sensible clinical choice, but a choice, and it lives in the integration rather than the archetype.",
  },
  {
    id: "bp-cuff", fhirBinding: {"strength": "none", "name": "No FHIR element exists for this item"}, group: "Blood pressure", label: "Cuff size",
    openehr: { archetype: BP, path: "/protocol[at0011]/items[at0013]", localCode: "at0017" }, value: "Adult (local at0017)",
    terms: [{ system: "SNOMED CT", code: "246153002", display: "Type of cuff", source: "archetype binding" }],
    fhir: null, how: "none",
    note: "FHIR Observation has no element for cuff size, so it is lost unless the exchange defines an extension. The node binding also deserves a look: 246153002 is 'Type of cuff', which is close to, but not the same as, cuff size.",
  },
  {
    id: "pulse-rate", fhirBinding: {"strength": "required-coding", "name": "The FHIR R4 heartrate profile requires a coding with system http://loinc.org and code 8867-4", "slice": "Observation.code.coding:HeartRateCode", "url": "https://hl7.org/fhir/R4/heartrate.html"}, group: "Pulse", label: "Rate",
    openehr: { archetype: PULSE, path: "/data[at0002]/events[at0003]/data[at0001]/items[at0004]" }, value: "78 /min",
    terms: [
      { system: "SNOMED CT", code: "364075005", display: "Heart rate", source: "mapping" },
      { system: "LOINC", code: "8867-4", display: "Heart rate", source: "FHIR profile" },
    ],
    fhir: "Observation (heartrate profile)", how: "mapped",
    note: "pulse.v2 has no binding on Rate. The mapping supplies both codes. It also makes a clinical decision: the archetype covers pulse and heart beat, while FHIR's profile is 'heart rate'.",
  },
  {
    id: "resp-rate", fhirBinding: {"strength": "required-coding", "name": "The FHIR R4 resprate profile requires a coding with system http://loinc.org and code 9279-1", "slice": "Observation.code.coding:RespRateCode", "url": "https://hl7.org/fhir/R4/resprate.html"}, group: "Respiration", label: "Rate",
    openehr: { archetype: RESP, path: "/data[at0001]/events[at0002]/data[at0003]/items[at0004]" }, value: "16 /min",
    terms: [
      { system: "SNOMED CT", code: "271625008", display: "Rate of spontaneous respiration", source: "archetype binding" },
      { system: "LOINC", code: "9279-1", display: "Respiratory rate", source: "FHIR profile" },
    ],
    fhir: "Observation (resprate profile)", how: "bound",
  },
  {
    id: "temp", fhirBinding: {"strength": "required-coding", "name": "The FHIR R4 bodytemp profile requires a coding with system http://loinc.org and code 8310-5", "slice": "Observation.code.coding:BodyTempCode", "url": "https://hl7.org/fhir/R4/bodytemp.html"}, group: "Body temperature", label: "Temperature",
    openehr: { archetype: TEMP, path: "/data[at0002]/events[at0003]/data[at0001]/items[at0004]" }, value: "37.1 Cel",
    terms: [
      { system: "SNOMED CT", code: "386725007", display: "Body temperature", source: "archetype binding" },
      { system: "LOINC", code: "8310-5", display: "Body temperature", source: "archetype binding" },
    ],
    fhir: "Observation (bodytemp profile)", how: "bound",
    note: "Both codes come straight from the archetype. The LOINC binding is written with the old terminology id LNC205; in FHIR it becomes http://loinc.org.",
  },
  {
    id: "temp-site", fhirBinding: {"strength": "example", "name": "Observation.bodySite: SNOMED CT body structures are given only as an example (body-site value set)", "url": "https://hl7.org/fhir/R4/valueset-body-site.html"}, group: "Body temperature", label: "Location of measurement",
    openehr: { archetype: TEMP, path: "/protocol[at0020]/items[at0021]", localCode: "at0024" }, value: "Axilla (local at0024)",
    terms: [{ system: "SNOMED CT", code: "91470000", display: "Axillary region structure", source: "mapping" }],
    fhir: "Observation.bodySite", how: "mapped",
  },
  {
    id: "spo2", fhirBinding: {"strength": "required-coding", "name": "The FHIR R4 oxygensat profile requires a coding with system http://loinc.org and code 2708-6", "slice": "Observation.code.coding:OxygenSatCode", "url": "https://hl7.org/fhir/R4/oxygensat.html"}, group: "Pulse oximetry", label: "SpO₂",
    openehr: { archetype: SPO2, path: "/data[at0001]/events[at0002]/data[at0003]/items[at0006]" }, value: "97/100 (DV_PROPORTION, percent)",
    terms: [
      { system: "SNOMED CT", code: "431314004", display: "Peripheral oxygen saturation", source: "archetype binding" },
      { system: "LOINC", code: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry", source: "archetype binding" },
      { system: "LOINC", code: "2708-6", display: "Oxygen saturation in Arterial blood", source: "FHIR profile" },
    ],
    fhir: "Observation (oxygensat profile)", how: "bound",
    note: "Different data types: openEHR records a proportion (97 out of 100, type 'percent'), FHIR a Quantity of 97 %. The FHIR profile also requires LOINC 2708-6 next to the pulse-oximetry code the archetype provides.",
  },
];

export default {
  id: "vital-signs",
  title: "Vital signs",
  fhirTitle: "Bundle of 5 Observations (FHIR R4 vital-signs profiles)",
  template: "vital-signs-monitoring.opt",
  scenario: {
    "summary": "Blood pressure, pulse, respiration, temperature and SpO₂ at a ward round",
    "number": 1,
    "setting": "Hospital ward: routine observations",
    "recordedBy": "Ward nurse",
    "when": "18 November 2026, 09:30",
    "recorded": [
      "Blood pressure 148/92 mmHg, sitting, right arm, adult cuff",
      "Pulse 78 per minute",
      "Respiration 16 per minute",
      "Temperature 37.1 °C, measured in the axilla",
      "SpO₂ 97 %"
    ],
    "exchange": "Sent as five FHIR Observations, one per vital sign, for example to a regional record or an early-warning system."
  },
  story: "A nurse records a set of vital signs at 09:30: blood pressure 148/92 mmHg sitting, right arm, adult cuff; pulse 78/min; respiration 16/min; temperature 37.1 °C in the axilla; SpO₂ 97 %.",
  openehrTitle: "COMPOSITION from template 'Vital signs monitoring' (canonical JSON, abridged)",
  openehr,
  fhir,
  links,
  sources: [
    {
      "role": "openEHR template",
      "text": "“Vital signs monitoring” operational template, from the CaboLabs openEHR-SDK test resources (Apache-2.0)",
      "url": "https://github.com/CaboLabs/openEHR-SDK"
    },
    {
      "role": "openEHR archetypes",
      "text": "blood_pressure.v2, pulse.v2, respiration.v2, body_temperature.v2, pulse_oximetry.v1 and their terminology bindings: openEHR Clinical Knowledge Manager (CKM), CC BY-SA 4.0",
      "url": "https://ckm.openehr.org/ckm/"
    },
    {
      "role": "openEHR specifications",
      "text": "openEHR Reference Model (EHR, data types) and the canonical JSON format used for the openEHR data",
      "url": "https://specifications.openehr.org/releases/RM/latest/ehr.html"
    },
    {
      "role": "FHIR",
      "text": "HL7 FHIR R4 vital-signs profiles (bp, heartrate, resprate, bodytemp, oxygensat)",
      "url": "https://hl7.org/fhir/R4/observation-vitalsigns.html"
    },
    {
      "role": "FHIR",
      "text": "HL7 FHIR R4 extension observation-bodyPosition",
      "url": "https://hl7.org/fhir/R4/extension-observation-bodyposition.html"
    },
    {
      "role": "SNOMED CT",
      "text": "SNOMED CT International Edition. Codes checked as active in the 2026-01-01 release, through the SNOMED International Snowstorm Lite demo server. Use requires an Affiliate or national licence.",
      "url": "https://www.snomed.org/get-snomed"
    },
    {
      "role": "LOINC",
      "text": "LOINC codes © Regenstrief Institute, Inc., used under the LOINC licence",
      "url": "https://loinc.org/"
    },
    {
      "role": "Mapping",
      "text": "The openEHR → FHIR mapping and the example values were written for this demonstrator for teaching. They are not an official or published mapping."
    }
  ],
  points: [
    "One openEHR composition, five archetypes. In FHIR this becomes five Observation resources: one per vital sign, each following a profile.",
    "Where the archetype has a SNOMED CT binding, the meaning travels with no extra decision: systolic, diastolic, respiration rate, temperature, SpO₂.",
    "Where the archetype only has local codes (position, location), meaning reaches FHIR only through a mapping someone has decided. This is where consistency is won or lost.",
    "FHIR's vital-signs profiles require LOINC codes. SNOMED CT and LOINC appear side by side: SNOMED CT for the meaning, LOINC because the profile demands it.",
    "Some details have no home in FHIR (cuff size). The openEHR record keeps them; the message does not.",
  ],
};
