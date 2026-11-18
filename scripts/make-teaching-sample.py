#!/usr/bin/env python3
"""Generate samples/teaching-edge-cases.opt — a SYNTHETIC OPT 1.4 file that packs
the edge cases the explorer must handle into one small template. The archetype
(openEHR-EHR-OBSERVATION.teaching_example.v0) does not exist in CKM."""

def iv(lo, hi, tag="occurrences"):
    up = "<upper_unbounded>true</upper_unbounded>" if hi is None else f"<upper_unbounded>false</upper_unbounded><upper>{hi}</upper>"
    inc = "" if hi is None else "<upper_included>true</upper_included>"
    return f"<{tag}><lower_included>true</lower_included>{inc}<lower_unbounded>false</lower_unbounded>{up.replace('<upper>', f'<lower>{lo}</lower><upper>') if hi is not None else up + f'<lower>{lo}</lower>'}</{tag}>"

def attr(name, children, multiple=False, existence=(1, 1)):
    t = "C_MULTIPLE_ATTRIBUTE" if multiple else "C_SINGLE_ATTRIBUTE"
    card = f"<cardinality><is_ordered>false</is_ordered><is_unique>false</is_unique>{iv(0, None, 'interval')}</cardinality>" if multiple else ""
    return f'<attributes xsi:type="{t}"><rm_attribute_name>{name}</rm_attribute_name>{iv(*existence, "existence")}{"".join(children)}{card}</attributes>'

def obj(rm, node_id="", occ=(1, 1), attrs=(), xtype="C_COMPLEX_OBJECT", extra=""):
    return f'<children xsi:type="{xtype}"><rm_type_name>{rm}</rm_type_name>{iv(*occ)}<node_id>{node_id}</node_id>{"".join(attrs)}{extra}</children>'

def code_phrase(terminology, codes):
    cl = "".join(f"<code_list>{c}</code_list>" for c in codes)
    return f'<children xsi:type="C_CODE_PHRASE"><rm_type_name>CODE_PHRASE</rm_type_name>{iv(1, 1)}<node_id/><terminology_id><value>{terminology}</value></terminology_id>{cl}</children>'

def coded_text(cp):
    return obj("DV_CODED_TEXT", attrs=[attr("defining_code", [cp])])

def element(node_id, value_children, occ=(0, 1), name=None):
    attrs = []
    if name:
        attrs.append(attr("name", [obj("DV_TEXT", attrs=[attr("value", [
            f'<children xsi:type="C_PRIMITIVE_OBJECT"><rm_type_name>STRING</rm_type_name>{iv(1, 1)}<node_id/><item xsi:type="C_STRING"><list>{name}</list></item></children>'])])]))
    if value_children:
        attrs.append(attr("value", value_children, existence=(0, 1)))
    return obj("ELEMENT", node_id, occ, attrs)

ref_uri = "terminology://fhir.hl7.org/ValueSet/$expand?url=http://snomed.info/sct?fhir_vs=ecl/%3C%3C404684003"
items = [
    element("at0004", [coded_text(f'<children xsi:type="C_CODE_REFERENCE"><rm_type_name>CODE_PHRASE</rm_type_name>{iv(1, 1)}<node_id/><referenceSetUri>{ref_uri}</referenceSetUri></children>')]),
    element("at0005", [coded_text(code_phrase("local", ["at0006", "at0007", "at0008"]))]),
    element("at0009", [obj("DV_TEXT")]),
    element("at0010", [obj("DV_TEXT")], occ=(0, 0)),
    element("at0011", [obj("DV_BOOLEAN", attrs=[attr("value", [f'<children xsi:type="C_PRIMITIVE_OBJECT"><rm_type_name>BOOLEAN</rm_type_name>{iv(1, 1)}<node_id/><item xsi:type="C_BOOLEAN"><true_valid>true</true_valid><false_valid>true</false_valid></item></children>'])])], name="Left side"),
    element("at0011", [obj("DV_BOOLEAN")], name="Right side"),
    element("at0012", [obj("DV_COUNT", attrs=[attr("magnitude", [f'<children xsi:type="C_PRIMITIVE_OBJECT"><rm_type_name>INTEGER</rm_type_name>{iv(1, 1)}<node_id/><item xsi:type="C_INTEGER">{iv(0, 20, "range")}</item></children>'])])]),
    element("at0013", [f'<children xsi:type="C_DV_ORDINAL"><rm_type_name>DV_ORDINAL</rm_type_name>{iv(1, 1)}<node_id/>'
                       + "".join(f"<list><value>{v}</value><symbol><terminology_id><value>local</value></terminology_id><code_string>{c}</code_string></symbol></list>" for v, c in [(0, "at0014"), (1, "at0015"), (2, "at0016")])
                       + "</children>"]),
    element("at0017", [coded_text(code_phrase("SNOMED-CT", ["373066001", "373067005"]))]),
    element("at0018", [f'<children xsi:type="C_DV_QUANTITY"><rm_type_name>DV_QUANTITY</rm_type_name>{iv(1, 1)}<node_id/><property><terminology_id><value>openehr</value></terminology_id><code_string>127</code_string></property>'
                       f'<list><units>Cel</units>{iv(30, 45, "magnitude")}{iv(1, 1, "precision")}</list><list><units>[degF]</units>{iv(86, 113, "magnitude")}</list></children>']),
]
slot = ('<children xsi:type="ARCHETYPE_SLOT"><rm_type_name>CLUSTER</rm_type_name>' + iv(0, None) + '<node_id>at0019</node_id><includes><expression xsi:type="EXPR_BINARY_OPERATOR"><type>Boolean</type><operator>2007</operator><precedence_overridden>false</precedence_overridden>'
        '<left_operand xsi:type="EXPR_LEAF"><type>String</type><item xsi:type="xsd:string">archetype_id/value</item><reference_type>attribute</reference_type></left_operand>'
        '<right_operand xsi:type="EXPR_LEAF"><type>C_STRING</type><item xsi:type="C_STRING"><pattern>openEHR-EHR-CLUSTER\\.device\\.v1</pattern></item><reference_type>constraint</reference_type></right_operand></expression></includes></children>')

terms = {
    "at0000": ("Teaching example", "Synthetic observation used to test the explorer."),
    "at0001": ("History", "@ internal @"), "at0002": ("Any event", "Default event."), "at0003": ("Tree", "@ internal @"),
    "at0004": ("Finding", "Any SNOMED CT clinical finding (external value set)."),
    "at0005": ("Severity", "Partly bound local value set."), "at0006": ("Mild", "Mild."), "at0007": ("Moderate", "Moderate."), "at0008": ("Severe", "Severe."),
    "at0009": ("Comment", "Free text, no binding."), "at0010": ("Removed item", "Excluded in the template (0..0)."),
    "at0011": ("Side present", "Cloned and renamed in the template."), "at0012": ("Number of episodes", "Path-bound element."),
    "at0013": ("Score", "Ordinal."), "at0014": ("None", ""), "at0015": ("Some", ""), "at0016": ("A lot", ""),
    "at0017": ("Confirmed?", "External code list (SNOMED CT yes/no)."), "at0018": ("Temperature", "Quantity with two units."),
    "at0019": ("Device", "Slot for device details."),
}
term_xml = "".join(f'<term_definitions code="{c}"><items id="text">{t}</items><items id="description">{d}</items></term_definitions>' for c, (t, d) in terms.items())

def binding(code, term_id, code_string):
    return f'<items code="{code}"><value><terminology_id><value>{term_id}</value></terminology_id><code_string>{code_string}</code_string></value></items>'

bindings = ('<term_bindings terminology="SNOMED-CT">'
            + binding("at0000", "SNOMED-CT", "363787002")                       # plain
            + binding("at0006", "SNOMED-CT(2003)", "255604002")                 # version-stamped, on a value
            + binding("at0007", "SNOMED-CT", "[SNOMED-CT(2003)::6736007]")      # bracketed, on a value
            + binding("at0018", "SNOMED-CT", "http://snomed.info/id/386725007") # URI form
            + binding("at0099", "SNOMED-CT", "12345678")                        # code not in the template
            + '</term_bindings><term_bindings terminology="LOINC">'
            + binding("/data[at0001]/events[at0002]/data[at0003]/items[at0012]", "LOINC", "8310-5")  # path-based
            + '</term_bindings>')

observation = obj("OBSERVATION", "at0000", (0, 1), xtype="C_ARCHETYPE_ROOT", attrs=[
    attr("data", [obj("HISTORY", "at0001", attrs=[attr("events", [obj("EVENT", "at0002", (0, None), attrs=[
        attr("data", [obj("ITEM_TREE", "at0003", attrs=[attr("items", items + [slot], multiple=True)])])])], multiple=True)])])],
    extra=f"<archetype_id><value>openEHR-EHR-OBSERVATION.teaching_example.v0</value></archetype_id>{term_xml}{bindings}")
# archetype_id must precede term definitions in schema order; move it right after node_id
observation = observation.replace("<node_id>at0000</node_id>", "<node_id>at0000</node_id><archetype_id><value>openEHR-EHR-OBSERVATION.teaching_example.v0</value></archetype_id>", 1).replace(
    f"{term_xml}".join(["<archetype_id><value>openEHR-EHR-OBSERVATION.teaching_example.v0</value></archetype_id>", ""]), term_xml, 1)

comp_terms = '<term_definitions code="at0000"><items id="text">Encounter</items><items id="description">Interaction, contact or care event between a subject of care and healthcare provider(s).</items></term_definitions>'
xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- SYNTHETIC teaching sample generated by scripts/make-teaching-sample.py. Not a CKM template. -->
<template xmlns="http://schemas.openehr.org/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
<language><terminology_id><value>ISO_639-1</value></terminology_id><code_string>en</code_string></language>
<description><original_author id="name">openEHR Template Explorer</original_author><lifecycle_state>unmanaged</lifecycle_state>
<details><language><terminology_id><value>ISO_639-1</value></terminology_id><code_string>en</code_string></language><purpose>Synthetic template covering parser edge cases.</purpose></details></description>
<template_id><value>Teaching edge cases.v0</value></template_id>
<concept>Teaching edge cases</concept>
<definition><rm_type_name>COMPOSITION</rm_type_name>{iv(1, 1)}<node_id>at0000</node_id>
{attr("category", [coded_text(code_phrase("openehr", ["433"]))])}
{attr("content", [observation], multiple=True, existence=(0, 1))}
<archetype_id><value>openEHR-EHR-COMPOSITION.encounter.v1</value></archetype_id>{comp_terms}
</definition>
</template>
'''
open("samples/teaching-edge-cases.opt", "w").write(xml)  # then: xmllint --format -o samples/teaching-edge-cases.opt samples/teaching-edge-cases.opt
print("wrote samples/teaching-edge-cases.opt", len(xml))
