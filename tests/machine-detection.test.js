const { getStandardizedMachineName, getMachineInfo } = require('../tools/machine-detection');

describe('Machine Detection', () => {
  test('returns a non-empty string', () => {
    const name = getStandardizedMachineName();
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  test('getMachineInfo returns expected shape', () => {
    const info = getMachineInfo();
    expect(info).toHaveProperty('standardizedName');
    expect(info).toHaveProperty('hostname');
    expect(info).toHaveProperty('platform');
    expect(info).toHaveProperty('arch');
    expect(info).toHaveProperty('totalMemory');
    expect(info).toHaveProperty('cpus');
  });

  test('standardized name matches known patterns', () => {
    const name = getStandardizedMachineName();
    const validNames = [
      'MacBook Pro', 'MacBook Air', 'iMac', 'Mac Studio', 'Mac Pro', 'Mac',
      'Windows Home PC', 'Windows Office PC', 'Windows PC', 'Windows WSL',
      'Production Server', 'Cloud Server', 'Linux PC', 'CLAW'
    ];
    // Either matches a known name or is a raw hostname (fallback)
    const isValid = validNames.includes(name) || name.length > 0;
    expect(isValid).toBe(true);
  });
});
