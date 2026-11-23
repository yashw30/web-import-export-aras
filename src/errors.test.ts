import { describe, expect, it } from "vitest";
import { explainFailure } from "./errors.js";

const SERVER_ERROR = `****ErrorMessage****

Import package 'steepgraph.IPMS.ProjectTemplateOOTBFix' failed with message:

Server error

Request: <Item type="RelationshipType" id="DB18A7F87EA44736B5CB10575A46B4B7" action="add" dependencyLevel="0" doGetItem="0"><auto_search>1</auto_search><name>sg_rel_customer_projectTemplate</name></Item>

Responce: <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault xmlns:af="http://www.aras.com/InnovatorFault"><faultcode>SOAP-ENV:Server</faultcode><faultstring><![CDATA[Property "Instance Data" with value "SG_REL_CUSTOMER_PROJECTTEMPLATE" of itemtype "ItemType" exceeds the maximum length of 30 characters.]]></faultstring><detail><af:legacy_detail><![CDATA[Property "Instance Data" with value "SG_REL_CUSTOMER_PROJECTTEMPLATE" of itemtype "ItemType" exceeds the maximum length of 30 characters.]]></af:legacy_detail></detail></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>
Updating steepgraph.IPMS.ProjectTemplateOOTBFix to failed release status`;

describe("explainFailure", () => {
  it("finds the cause in the fault, not in the request", () => {
    const explained = explainFailure(SERVER_ERROR);
    expect(explained.summary).toBe(
      'Property "Instance Data" with value "SG_REL_CUSTOMER_PROJECTTEMPLATE" of itemtype "ItemType" exceeds the maximum length of 30 characters.',
    );
  });

  it("names the package and the item that was being sent", () => {
    const explained = explainFailure(SERVER_ERROR);
    expect(explained.packageName).toBe("steepgraph.IPMS.ProjectTemplateOOTBFix");
    expect(explained.where).toBe('package steepgraph.IPMS.ProjectTemplateOOTBFix · RelationshipType "sg_rel_customer_projectTemplate" (add)');
  });

  it("keeps the whole text for the details view", () => {
    expect(explainFailure(SERVER_ERROR).raw).toBe(SERVER_ERROR);
  });

  it("falls back to the first meaningful line when there is no fault", () => {
    const explained = explainFailure("Could not find a part of the path '/CUSTOM_Package/X'.\nsecond line");
    expect(explained.summary).toBe("Could not find a part of the path '/CUSTOM_Package/X'.");
    expect(explained.where).toBe("");
  });

  it("reads the message of an af:exception when there is no faultstring", () => {
    const explained = explainFailure('Request: <Item type="Method" action="add"/>\nResponce: <af:exception message="Item &quot;x&quot; is locked." />');
    expect(explained.summary).toBe('Item "x" is locked.');
  });
});

describe("explainFailure, formatted layout", () => {
  const FORMATTED = `Import package 'p' failed with message:

Request (formatted):
<Item type="RelationshipType" action="add">
  <name>sg_rel_x</name>
</Item>

Response (formatted):
<SOAP-ENV:Envelope>
  <SOAP-ENV:Body>
    <SOAP-ENV:Fault>
      <faultstring><![CDATA[Property "Instance Data" of itemtype "ItemType" exceeds the maximum length of 30 characters.]]></faultstring>
    </SOAP-ENV:Fault>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  it("finds the cause and the item", () => {
    const explained = explainFailure(FORMATTED);
    expect(explained.summary).toBe('Property "Instance Data" of itemtype "ItemType" exceeds the maximum length of 30 characters.');
    expect(explained.where).toBe('package p · RelationshipType "sg_rel_x" (add)');
  });
});
