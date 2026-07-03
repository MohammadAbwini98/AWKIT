import type { RuntimeInputDefinition } from "@src/data/RuntimeInputDefinition";

export const sampleCustomersData = {
  customers: [
    {
      firstName: "Mohammad",
      lastName: "Abwini",
      email: "mohammad@example.com",
      country: "JO",
      accountType: "BUSINESS",
      segment: "VIP"
    },
    {
      firstName: "Sara",
      lastName: "Haddad",
      email: "sara@example.com",
      country: "AE",
      accountType: "CORPORATE",
      segment: "STANDARD"
    },
    {
      firstName: "Omar",
      lastName: "Nasser",
      email: "omar@example.com",
      country: "SA",
      accountType: "PERSONAL",
      segment: "REVIEW"
    }
  ]
};

export const runtimeInputDefinitions: RuntimeInputDefinition[] = [
  {
    key: "selectedAccountType",
    label: "Account Type",
    type: "dropdown",
    required: true,
    defaultValue: "BUSINESS",
    options: [
      { label: "Personal", value: "PERSONAL" },
      { label: "Business", value: "BUSINESS" },
      { label: "Corporate", value: "CORPORATE" }
    ]
  },
  {
    key: "selectedCountry",
    label: "Country",
    type: "dropdown",
    required: true,
    defaultValue: "JO",
    options: [
      { label: "Jordan", value: "JO" },
      { label: "Saudi Arabia", value: "SA" },
      { label: "United Arab Emirates", value: "AE" }
    ]
  },
  {
    key: "customerSegment",
    label: "Customer Segment",
    type: "dropdown",
    required: true,
    defaultValue: "VIP",
    options: [
      { label: "VIP", value: "VIP" },
      { label: "Standard", value: "STANDARD" },
      { label: "Needs Review", value: "REVIEW" }
    ]
  },
  {
    key: "runCount",
    label: "Number of Instances",
    type: "number",
    required: true,
    defaultValue: 3
  },
  {
    key: "customerDataFile",
    label: "Customer Data File",
    type: "file",
    required: true,
    defaultValue: "resources/sample-data/customers.json"
  }
];
