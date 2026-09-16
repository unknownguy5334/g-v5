import { getCurrentAcademicContext } from '../server/services/academicContext';

async function runTests() {
  const datesToTest = [
    { date: '2026-09-01', expectedTerm: 'FALL', expectedYear: '2026–2027' },
    { date: '2026-12-15', expectedTerm: 'FALL', expectedYear: '2026–2027' },
    { date: '2027-01-19', expectedTerm: 'FALL', expectedYear: '2026–2027' },
    { date: '2027-01-20', expectedTerm: 'SPRING', expectedYear: '2026–2027' },
    { date: '2027-05-31', expectedTerm: 'SPRING', expectedYear: '2026–2027' },
    { date: '2027-06-19', expectedTerm: 'SPRING', expectedYear: '2026–2027' },
    { date: '2027-06-20', expectedTerm: 'SUMMER', expectedYear: '2026–2027' },
    { date: '2027-08-31', expectedTerm: 'SUMMER', expectedYear: '2026–2027' },
    { date: '2027-09-01', expectedTerm: 'FALL', expectedYear: '2027–2028' },
  ];

  for (const test of datesToTest) {
    const mockDate = new Date(`${test.date}T12:00:00Z`);

    const context = await getCurrentAcademicContext(mockDate);
    if (context.term === test.expectedTerm && context.academicYear === test.expectedYear) {
      console.log(`✅ ${test.date} -> ${context.term} / ${context.academicYear}`);
    } else {
      console.error(`❌ ${test.date} FAILED! Got ${context.term} / ${context.academicYear}`);
      process.exit(1);
    }
  }
}

runTests().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
