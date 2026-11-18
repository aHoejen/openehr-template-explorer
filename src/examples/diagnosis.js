import { evaluation, element, coded, dateTime, text, cluster, SCT, coding } from "./rm.js";

const PD = "openEHR-EHR-EVALUATION.problem_diagnosis.v1";
const QUAL = "openEHR-EHR-CLUSTER.problem_qualifier.v2";
const SECTION = "openEHR-EHR-SECTION.adhoc.v1";

const openehr = {
  _type: "SECTION",
  name: text("IPS Problem List"),
  archetype_node_id: SECTION,
  archetype_details: { template_id: { value: "IPS Problem List" } },
  _link: "section",
  items: [
    evaluation({
      archetypeId: PD, name: "Problem/Diagnosis", subjectLink: "subject",
      dataId: "at0001", dataName: "structure",
      data: [
        element("at0002", "Problem/Diagnosis name", coded("Essential hypertension", "SNOMED-CT", "59621000"), "name"),
        element("at0077", "Date/time of onset", dateTime("2019-03-14"), "onset"),
        element("at0005", "Severity", coded("Moderate", "local", "at0048"), "severity"),
        cluster(QUAL, "Problem/Diagnosis qualifier", [
          element("at0003", "Active/Inactive?", coded("Active", "local", "at0026"), "active"),
        ]),
        element("at0073", "Diagnostic certainty", coded("Confirmed", "local", "at0076"), "certainty"),
      ],
    }),
  ],
};

const fhir = {
  resourceType: "Condition",
  id: "hypertension",
  meta: { profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Condition-uv-ips"] },
  clinicalStatus: { coding: [coding("http://terminology.hl7.org/CodeSystem/condition-clinical", "active", "Active")], _link: "active" },
  verificationStatus: { coding: [coding("http://terminology.hl7.org/CodeSystem/condition-ver-status", "confirmed", "Confirmed")], _link: "certainty" },
  category: [{ coding: [coding("http://terminology.hl7.org/CodeSystem/condition-category", "problem-list-item", "Problem List Item")], _link: "section" }],
  severity: { coding: [coding(SCT, "6736007", "Moderate")], _link: "severity" },
  code: { coding: [coding(SCT, "59621000", "Essential hypertension")], text: "Essential hypertension", _link: "name" },
  subject: { reference: "Patient/example", _link: "subject" },
  onsetDateTime: "2019-03-14",
};

const links = [
  {
    id: "name", group: "Problem/Diagnosis", label: "Problem/Diagnosis name",
    openehr: { archetype: PD, path: "/data[at0001]/items[at0002]" }, value: "Essential hypertension (SNOMED CT 59621000)",
    terms: [{ system: "SNOMED CT", code: "59621000", display: "Essential hypertension", source: "recorded value" }],
    fhir: "Condition.code", how: "coded",
    note: "Here SNOMED CT is the recorded value, not a binding on the node. The IPS template constrains this element to the IPS 'problems' value set, the same value set the FHIR IPS Condition profile uses. Template and message were designed to line up, so the code is copied as it is.",
  },
  {
    id: "onset", group: "Problem/Diagnosis", label: "Date/time of onset",
    openehr: { archetype: PD, path: "/data[at0001]/items[at0077]" }, value: "2019-03-14",
    terms: [], fhir: "Condition.onsetDateTime", fhirPointers: ["/onsetDateTime"], how: "direct",
  },
  {
    id: "severity", group: "Problem/Diagnosis", label: "Severity",
    openehr: { archetype: PD, path: "/data[at0001]/items[at0005]", localCode: "at0048" }, value: "Moderate (local at0048)",
    terms: [{ system: "SNOMED CT", code: "6736007", display: "Moderate", source: "mapping" }],
    fhir: "Condition.severity", how: "mapped",
    note: "The archetype's Mild/Moderate/Severe are local codes. FHIR's Condition.severity uses SNOMED CT severity qualifiers, so the mapping translates at0048 into 6736007.",
  },
  {
    id: "active", group: "Problem/Diagnosis", label: "Active/Inactive?",
    openehr: { archetype: QUAL, path: "/items[at0003]", localCode: "at0026" }, value: "Active (local at0026)",
    terms: [{ system: "FHIR", code: "active", display: "condition-clinical", source: "FHIR code system" }],
    fhir: "Condition.clinicalStatus", how: "fhir-code",
    note: "Status values are not SNOMED CT in FHIR: they come from FHIR's own required code system. The mapping is a small fixed table, and it sits in a separate CLUSTER archetype (problem_qualifier) inside the evaluation.",
  },
  {
    id: "certainty", group: "Problem/Diagnosis", label: "Diagnostic certainty",
    openehr: { archetype: PD, path: "/data[at0001]/items[at0073]", localCode: "at0076" }, value: "Confirmed (local at0076)",
    terms: [{ system: "FHIR", code: "confirmed", display: "condition-ver-status", source: "FHIR code system" }],
    fhir: "Condition.verificationStatus", how: "fhir-code",
    note: "Suspected and Probable have no exact match in FHIR's verification status ('provisional' and 'differential' are near). This is a known judgement call in openEHR–FHIR mappings.",
  },
  {
    id: "section", group: "Context", label: "Which list it is on",
    openehr: { archetype: SECTION, path: "/" }, value: "SECTION 'IPS Problem List'",
    terms: [{ system: "FHIR", code: "problem-list-item", display: "condition-category", source: "FHIR code system" }],
    fhir: "Condition.category", how: "context",
    note: "No data element says 'this is a problem-list item'. It follows from the template: the evaluation sits in the IPS Problem List section. The FHIR structure is specific to the template.",
  },
  {
    id: "subject", group: "Context", label: "The patient",
    openehr: { archetype: PD, path: null, rm: "EVALUATION.subject (PARTY_SELF)" }, value: "PARTY_SELF: the owner of this EHR",
    terms: [], fhir: "Condition.subject", how: "context",
    note: "In openEHR the patient is implicit: every record lives in one patient's EHR, and the entry just says 'self'. FHIR resources travel on their own, so each must point to a Patient explicitly.",
  },
];

export default {
  id: "diagnosis",
  title: "Diagnosis",
  fhirTitle: "Condition (IPS profile)",
  template: "ips-problem-list.opt",
  story: "The GP confirms essential hypertension, first noted in March 2019, as an active problem of moderate severity on the patient's problem list.",
  openehrTitle: "SECTION from template 'IPS Problem List' (canonical JSON, abridged)",
  openehr,
  fhir,
  links,
  points: [
    "SNOMED CT is used in two ways in openEHR. The archetype can bind a node to a concept (what the element means), or the data can hold a SNOMED CT code as its value (what was found). The diagnosis is the second kind.",
    "The IPS template points its coded elements at the same value sets as the IPS FHIR profiles, so the codes pass through unchanged.",
    "Local codes for severity, status and certainty need a mapping: some to SNOMED CT (severity), some to FHIR's own code systems (status, certainty).",
    "Part of the FHIR message comes from the template, not the data: the category and the patient reference.",
  ],
};
