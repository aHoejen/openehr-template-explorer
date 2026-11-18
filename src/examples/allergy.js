import { evaluation, element, coded, dateTime, text, cluster, SCT, coding } from "./rm.js";

const ARR = "openEHR-EHR-EVALUATION.adverse_reaction_risk.v2";
const EVENT = "openEHR-EHR-CLUSTER.adverse_reaction_event.v1";
const SECTION = "openEHR-EHR-SECTION.adhoc.v1";

const openehr = {
  _type: "SECTION",
  name: text("IPS Allergies and Intolerances"),
  archetype_node_id: SECTION,
  archetype_details: { template_id: { value: "IPS Allergies and Intolerances" } },
  items: [
    evaluation({
      archetypeId: ARR, name: "Adverse reaction risk",
      dataId: "at0001", dataName: "Tree",
      data: [
        element("at0002", "Substance", coded("Penicillin", "SNOMED-CT", "764146007"), "substance"),
        element("at0130", "Active/inactive status", coded("Active", "local", "at0131"), "status"),
        element("at0063", "Verification status", coded("Confirmed", "local", "at0065"), "verification"),
        element("at0101", "Criticality", coded("High", "local", "at0103"), "criticality"),
        element("at0120", "Category", text("Medication"), "category"),
        cluster(EVENT, "Adverse reaction event", [
          element("at0006", "Manifestation", coded("Urticaria", "SNOMED-CT", "126485001"), "manifestation"),
          element("at0008", "Onset of reaction", dateTime("2021-06-02"), "reaction-onset"),
          element("at0010", "Severity of reaction", coded("Moderate", "local", "at0012"), "reaction-severity"),
          element("at0017", "Route of exposure", text("Oral"), "route"),
        ], "reaction"),
      ],
    }),
  ],
};

const fhir = {
  resourceType: "AllergyIntolerance",
  id: "penicillin",
  meta: { profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/AllergyIntolerance-uv-ips"] },
  clinicalStatus: { coding: [coding("http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", "active", "Active")], _link: "status" },
  verificationStatus: { coding: [coding("http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", "confirmed", "Confirmed")], _link: "verification" },
  category: ["medication"],
  criticality: "high",
  code: { coding: [coding(SCT, "764146007", "Penicillin")], text: "Penicillin", _link: "substance" },
  patient: { reference: "Patient/example" },
  reaction: [
    {
      manifestation: [{ coding: [coding(SCT, "126485001", "Urticaria")], _link: "manifestation" }],
      onset: "2021-06-02",
      severity: "moderate",
      exposureRoute: { text: "Oral", _link: "route" },
      _link: "reaction",
    },
  ],
};

const links = [
  {
    id: "substance", fhirBinding: {"strength": "preferred", "name": "AllergyIntolerance.code: IPS profile prefers the IPS allergies-and-intolerances value set (SNOMED CT)", "url": "https://hl7.org/fhir/uv/ips/StructureDefinition-AllergyIntolerance-uv-ips.html"}, group: "Adverse reaction risk", label: "Substance",
    openehr: { archetype: ARR, path: "/data[at0001]/items[at0002]" }, value: "Penicillin (SNOMED CT 764146007)",
    terms: [{ system: "SNOMED CT", code: "764146007", display: "Penicillin", source: "recorded value" }],
    fhir: "AllergyIntolerance.code", how: "coded",
    note: "Recorded as a SNOMED CT code, from the IPS allergies-and-intolerances value set that the template and the FHIR IPS profile share. The concept is the substance itself ('Substance with penicillin structure'). When we checked, an older penicillin concept, 373270004, was inactive. Validating codes against the current edition matters.",
  },
  {
    id: "status", fhirBinding: {"strength": "required", "name": "AllergyIntolerance.clinicalStatus must use FHIR's allergyintolerance-clinical codes", "url": "https://hl7.org/fhir/R4/valueset-allergyintolerance-clinical.html"}, group: "Adverse reaction risk", label: "Active/inactive status",
    openehr: { archetype: ARR, path: "/data[at0001]/items[at0130]", localCode: "at0131" }, value: "Active (local at0131)",
    terms: [{ system: "FHIR", code: "active", display: "allergyintolerance-clinical", source: "FHIR code system" }],
    fhir: "AllergyIntolerance.clinicalStatus", how: "fhir-code",
  },
  {
    id: "verification", fhirBinding: {"strength": "required", "name": "AllergyIntolerance.verificationStatus must use FHIR's allergyintolerance-verification codes", "url": "https://hl7.org/fhir/R4/valueset-allergyintolerance-verification.html"}, group: "Adverse reaction risk", label: "Verification status",
    openehr: { archetype: ARR, path: "/data[at0001]/items[at0063]", localCode: "at0065" }, value: "Confirmed (local at0065)",
    terms: [{ system: "FHIR", code: "confirmed", display: "allergyintolerance-verification", source: "FHIR code system" }],
    fhir: "AllergyIntolerance.verificationStatus", how: "fhir-code",
  },
  {
    id: "criticality", fhirBinding: {"strength": "required", "name": "AllergyIntolerance.criticality must be one of FHIR's codes low, high, unable-to-assess", "url": "https://hl7.org/fhir/R4/valueset-allergy-intolerance-criticality.html"}, group: "Adverse reaction risk", label: "Criticality",
    openehr: { archetype: ARR, path: "/data[at0001]/items[at0101]", localCode: "at0103" }, value: "High (local at0103)",
    terms: [{ system: "FHIR", code: "high", display: "allergy-intolerance-criticality", source: "FHIR code system" }],
    fhir: "AllergyIntolerance.criticality", fhirPointers: ["/criticality"], how: "fhir-code",
    note: "Low/High/Indeterminate map one-to-one to FHIR's required codes low/high/unable-to-assess.",
  },
  {
    id: "category", fhirBinding: {"strength": "required", "name": "AllergyIntolerance.category must be one of FHIR's codes food, medication, environment, biologic", "url": "https://hl7.org/fhir/R4/valueset-allergy-intolerance-category.html"}, group: "Adverse reaction risk", label: "Category",
    openehr: { archetype: ARR, path: "/data[at0001]/items[at0120]" }, value: "\"Medication\" (free text)",
    terms: [{ system: "FHIR", code: "medication", display: "allergy-intolerance-category", source: "FHIR code system" }],
    fhir: "AllergyIntolerance.category", fhirPointers: ["/category"], how: "text",
    note: "This template leaves Category as free text, but FHIR requires one of its four codes. Text can only be turned into a code by interpretation, which is fragile. Coding it in the template would make the mapping reliable.",
  },
  {
    id: "reaction", fhirBinding: {"strength": "none", "name": "A group of elements: no terminology involved"}, group: "Reaction", label: "Adverse reaction event",
    openehr: { archetype: EVENT, path: "/" }, value: "CLUSTER adverse_reaction_event.v1",
    terms: [], fhir: "AllergyIntolerance.reaction[0]", how: "direct",
    note: "A nested CLUSTER archetype in openEHR becomes a backbone element in FHIR. The structure lines up well.",
  },
  {
    id: "manifestation", fhirBinding: {"strength": "preferred", "name": "reaction.manifestation: IPS profile prefers the IPS allergy-reaction value set (SNOMED CT)", "url": "https://hl7.org/fhir/uv/ips/StructureDefinition-AllergyIntolerance-uv-ips.html"}, group: "Reaction", label: "Manifestation",
    openehr: { archetype: EVENT, path: "/items[at0006]" }, value: "Urticaria (SNOMED CT 126485001)",
    terms: [{ system: "SNOMED CT", code: "126485001", display: "Urticaria", source: "recorded value" }],
    fhir: "AllergyIntolerance.reaction.manifestation", how: "coded",
  },
  {
    id: "reaction-onset", fhirBinding: {"strength": "none", "name": "A date: no terminology involved"}, group: "Reaction", label: "Onset of reaction",
    openehr: { archetype: EVENT, path: "/items[at0008]" }, value: "2021-06-02",
    terms: [], fhir: "AllergyIntolerance.reaction.onset", fhirPointers: ["/reaction/0/onset"], how: "direct",
  },
  {
    id: "reaction-severity", fhirBinding: {"strength": "required", "name": "reaction.severity must be one of FHIR's codes mild, moderate, severe", "url": "https://hl7.org/fhir/R4/valueset-reaction-event-severity.html"}, group: "Reaction", label: "Severity of reaction",
    openehr: { archetype: EVENT, path: "/items[at0010]", localCode: "at0012" }, value: "Moderate (local at0012)",
    terms: [{ system: "FHIR", code: "moderate", display: "reaction-event-severity", source: "FHIR code system" }],
    fhir: "AllergyIntolerance.reaction.severity", fhirPointers: ["/reaction/0/severity"], how: "fhir-code",
    note: "Compare the diagnosis example: there FHIR prefers severity as SNOMED CT, here it requires FHIR's own codes. The same openEHR idea needs a different mapping for each FHIR resource.",
  },
  {
    id: "route", fhirBinding: {"strength": "example", "name": "reaction.exposureRoute: SNOMED CT routes are given only as an example (route-codes value set)", "url": "https://hl7.org/fhir/R4/valueset-route-codes.html"}, group: "Reaction", label: "Route of exposure",
    openehr: { archetype: EVENT, path: "/items[at0017]" }, value: "\"Oral\" (free text)",
    terms: [{ system: "SNOMED CT", code: "26643006", display: "Oral route", source: "possible, not recorded" }],
    fhir: "AllergyIntolerance.reaction.exposureRoute", how: "text",
    note: "Free text in this template, so it can only travel as text. If the template coded it, SNOMED CT 26643006 'Oral route' would carry the meaning.",
  },
];

export default {
  id: "allergy",
  title: "Allergy",
  fhirTitle: "AllergyIntolerance (IPS profile)",
  template: "ips-allergies-and-intolerances.opt",
  scenario: {
    "number": 3,
    "setting": "GP surgery: medication review",
    "recordedBy": "General practitioner",
    "when": "18 November 2026",
    "recorded": [
      "Allergy to penicillin: confirmed, active, high criticality",
      "Reaction in June 2021: moderate urticaria after an oral course"
    ],
    "exchange": "Shared as a FHIR AllergyIntolerance in the patient's International Patient Summary."
  },
  story: "The patient has a confirmed, high-criticality allergy to penicillin. In June 2021 an oral course caused moderate urticaria.",
  openehrTitle: "SECTION from template 'IPS Allergies and Intolerances' (canonical JSON, abridged)",
  openehr,
  fhir,
  links,
  sources: [
    {
      "role": "openEHR template",
      "text": "“IPS Allergies and Intolerances” template, openEHR CKM (CKM id 1013.26.1365), CC BY-SA 4.0",
      "url": "https://ckm.openehr.org/ckm/templates/1013.26.1365"
    },
    {
      "role": "openEHR archetypes",
      "text": "adverse_reaction_risk.v2 and adverse_reaction_event.v1: openEHR CKM, CC BY-SA 4.0",
      "url": "https://ckm.openehr.org/ckm/"
    },
    {
      "role": "openEHR specifications",
      "text": "openEHR Reference Model (EHR, data types) and the canonical JSON format used for the openEHR data",
      "url": "https://specifications.openehr.org/releases/RM/latest/ehr.html"
    },
    {
      "role": "FHIR",
      "text": "HL7 FHIR International Patient Summary (IPS) Implementation Guide: AllergyIntolerance (IPS) profile",
      "url": "https://hl7.org/fhir/uv/ips/StructureDefinition-AllergyIntolerance-uv-ips.html"
    },
    {
      "role": "SNOMED CT",
      "text": "SNOMED CT International Edition. Codes checked as active in the 2026-01-01 release, through the SNOMED International Snowstorm Lite demo server. Use requires an Affiliate or national licence.",
      "url": "https://www.snomed.org/get-snomed"
    },
    {
      "role": "Mapping",
      "text": "The openEHR → FHIR mapping and the example values were written for this demonstrator for teaching. They are not an official or published mapping."
    }
  ],
  points: [
    "The adverse-reaction archetypes carry no terminology bindings at all. Meaning comes from SNOMED CT values chosen from the IPS value sets in the template.",
    "When template and FHIR profile share value sets (substance, manifestation), SNOMED CT passes through unchanged. This is the strongest form of consistency.",
    "Status, criticality and reaction severity become FHIR's own codes, not SNOMED CT. Each needs a fixed mapping table.",
    "Free text in the template (category, route) can't become a reliable code in the message. Decisions in the template decide what the message can carry.",
  ],
};
