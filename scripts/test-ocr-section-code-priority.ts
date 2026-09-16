import assert from 'node:assert/strict';
import {
  extractSectionCodeFromRaw,
  getLegacySectionCode,
  isLikelyInternalId,
  adaptLegacyOcrPayload,
  modelOutputToCanonical,
  canonicalToAppSections,
  reconcileOCRSections,
} from '../src/utils/ocrExtractionCore';

console.log('--- RUNNING OCR SECTION CODE PRIORITY & REGRESSION TESTS ---');

// 1. Direct priority tests for extractSectionCodeFromRaw
// Priority 1: section_code
assert.equal(
  extractSectionCodeFromRaw({
    section_code: 'SEC-01',
    sectionCode: 'SEC-02',
    section_id: 'SEC-03',
    section_number: 'SEC-04',
    section: 'SEC-05',
    code: 'SEC-06',
    id: 'SEC-07',
  }),
  'SEC-01',
  'Priority 1: section_code must take precedence'
);

// Priority 2: sectionCode
assert.equal(
  extractSectionCodeFromRaw({
    sectionCode: 'SEC-02',
    section_id: 'SEC-03',
    section_number: 'SEC-04',
    section: 'SEC-05',
    code: 'SEC-06',
    id: 'SEC-07',
  }),
  'SEC-02',
  'Priority 2: sectionCode must take precedence when section_code is missing'
);

// Priority 3: section_id
assert.equal(
  extractSectionCodeFromRaw({
    section_id: 'SEC-03',
    section_number: 'SEC-04',
    section: 'SEC-05',
    code: 'SEC-06',
    id: 'SEC-07',
  }),
  'SEC-03',
  'Priority 3: section_id must take precedence when higher priority fields are missing'
);

// Priority 4: section_number
assert.equal(
  extractSectionCodeFromRaw({
    section_number: 'SEC-04',
    section: 'SEC-05',
    code: 'SEC-06',
    id: 'SEC-07',
  }),
  'SEC-04',
  'Priority 4: section_number must take precedence'
);

// Priority 5: section
assert.equal(
  extractSectionCodeFromRaw({
    section: 'SEC-05',
    code: 'SEC-06',
    id: 'SEC-07',
  }),
  'SEC-05',
  'Priority 5: section must take precedence'
);

// Priority 6: code
assert.equal(
  extractSectionCodeFromRaw({
    code: 'SEC-06',
    id: 'SEC-07',
  }),
  'SEC-06',
  'Priority 6: code must take precedence over id fallback'
);

// Fallback: id when valid visible section identifier
assert.equal(
  extractSectionCodeFromRaw({
    id: 'SEC-01',
  }),
  'SEC-01',
  'Fallback: id must be used when valid visible section identifier'
);

assert.equal(
  extractSectionCodeFromRaw({
    id: '01',
  }),
  '01',
  'Fallback: id must support numeric-string section code'
);

assert.equal(
  extractSectionCodeFromRaw({
    id: 1,
  }),
  '1',
  'Fallback: id must support number section code'
);

assert.equal(
  extractSectionCodeFromRaw({
    id: 'A01',
  }),
  'A01',
  'Fallback: id must support alphanumeric section code'
);

assert.equal(
  extractSectionCodeFromRaw({
    id: 'New01',
  }),
  'New01',
  'Fallback: id must support named section code'
);

// Internal ID / UUID exclusions
assert.equal(
  extractSectionCodeFromRaw({
    id: '550e8400-e29b-41d4-a716-446655440000',
  }),
  null,
  'Fallback: UUIDs must NOT be used as section code'
);

assert.equal(
  extractSectionCodeFromRaw({
    id: 'internal-db-id',
  }),
  null,
  'Fallback: internal database IDs must NOT be used as section code'
);

assert.equal(
  extractSectionCodeFromRaw({
    id: 'ocr:FIN_434:01:0',
  }),
  null,
  'Fallback: OCR placeholder IDs must NOT be used as section code'
);

assert.equal(
  extractSectionCodeFromRaw({
    id: 'chunk:0:section:1',
  }),
  null,
  'Fallback: Chunk placeholder IDs must NOT be used as section code'
);

assert.equal(
  extractSectionCodeFromRaw({
    id: 'temp:sec_123',
  }),
  null,
  'Fallback: Temp placeholder IDs must NOT be used as section code'
);

// User Specification Example 1:
// Input: { "course_code": "FIN 434", "id": "SEC-01" }
// Expected visible section code: SEC-01
const ex1Payload = adaptLegacyOcrPayload({
  courses: [{
    course_code: 'FIN 434',
    course_name: 'Financial Modeling',
    sections: [{
      id: 'SEC-01',
      meetings: [{ day: 'MON', start_time: '09:00', end_time: '10:15', type: 'Lecture' }],
    }],
  }],
});
const ex1Sections = canonicalToAppSections(modelOutputToCanonical(ex1Payload));
assert.equal(ex1Sections[0].sectionCode, 'SEC-01', 'Example 1: Visible section code must be SEC-01');
assert.equal(ex1Sections[0].sectionCodeMissing, false, 'Example 1: sectionCodeMissing must be false');
assert.notEqual(ex1Sections[0].id, 'SEC-01', 'Example 1: internal canonical section ID must remain separate from visible section code');

// User Specification Example 2:
// Input: { "course_code": "FIN 434", "section_code": "SEC-02", "id": "internal-db-id" }
// Expected visible section code: SEC-02
const ex2Payload = adaptLegacyOcrPayload({
  courses: [{
    course_code: 'FIN 434',
    course_name: 'Financial Modeling',
    sections: [{
      section_code: 'SEC-02',
      id: 'internal-db-id',
      meetings: [{ day: 'TUE', start_time: '10:00', end_time: '11:15', type: 'Lecture' }],
    }],
  }],
});
const ex2Sections = canonicalToAppSections(modelOutputToCanonical(ex2Payload));
assert.equal(ex2Sections[0].sectionCode, 'SEC-02', 'Example 2: Visible section code must be SEC-02');
assert.equal(ex2Sections[0].sectionCodeMissing, false, 'Example 2: sectionCodeMissing must be false');

// User Specification Example 3:
// Input: { "course_code": "FIN 434", "sectionCode": "SEC-03" }
// Expected visible section code: SEC-03
const ex3Payload = adaptLegacyOcrPayload({
  courses: [{
    course_code: 'FIN 434',
    course_name: 'Financial Modeling',
    sections: [{
      sectionCode: 'SEC-03',
      meetings: [{ day: 'WED', start_time: '14:00', end_time: '15:15', type: 'Lecture' }],
    }],
  }],
});
const ex3Sections = canonicalToAppSections(modelOutputToCanonical(ex3Payload));
assert.equal(ex3Sections[0].sectionCode, 'SEC-03', 'Example 3: Visible section code must be SEC-03');
assert.equal(ex3Sections[0].sectionCodeMissing, false, 'Example 3: sectionCodeMissing must be false');

// User Specification Example 4:
// Input: { "course_code": "FIN 434", "id": "550e8400-e29b-41d4-a716-446655440000" }
// Expected behavior: Do not display that UUID as the section code
const ex4Payload = adaptLegacyOcrPayload({
  courses: [{
    course_code: 'FIN 434',
    course_name: 'Financial Modeling',
    sections: [{
      id: '550e8400-e29b-41d4-a716-446655440000',
      meetings: [{ day: 'THU', start_time: '11:00', end_time: '12:15', type: 'Lecture' }],
    }],
  }],
});
const ex4Sections = canonicalToAppSections(modelOutputToCanonical(ex4Payload));
assert.equal(ex4Sections[0].sectionCode, null, 'Example 4: UUID must not be displayed as visible section code');
assert.equal(ex4Sections[0].sectionCodeMissing, true, 'Example 4: sectionCodeMissing must be true');

// Flat legacy array input testing
const flatLegacyPayload = adaptLegacyOcrPayload([
  { course_code: 'FIN 434', id: 'SEC-01', day: 'MON', start_time: '09:00', end_time: '10:15' },
  { course_code: 'FIN 434', section_code: 'SEC-02', id: 'internal-db-id', day: 'TUE', start_time: '10:00', end_time: '11:15' },
  { course_code: 'FIN 434', sectionCode: 'SEC-03', day: 'WED', start_time: '14:00', end_time: '15:15' },
  { course_code: 'FIN 434', id: '550e8400-e29b-41d4-a716-446655440000', day: 'THU', start_time: '11:00', end_time: '12:15' },
]);
const flatSections = reconcileOCRSections(canonicalToAppSections(modelOutputToCanonical(flatLegacyPayload)));

const finSections = flatSections.filter((s) => s.courseCode === 'FIN 434');
assert.equal(finSections.length, 4, 'Should extract all 4 section entries');
assert.equal(finSections.some((s) => s.sectionCode === 'SEC-01'), true, 'SEC-01 preserved');
assert.equal(finSections.some((s) => s.sectionCode === 'SEC-02'), true, 'SEC-02 preserved');
assert.equal(finSections.some((s) => s.sectionCode === 'SEC-03'), true, 'SEC-03 preserved');
assert.equal(finSections.some((s) => s.sectionCode === '550e8400-e29b-41d4-a716-446655440000'), false, 'UUID rejected');

console.log('✅ ALL OCR SECTION CODE PRIORITY TESTS PASSED SUCCESSFULLY!');
