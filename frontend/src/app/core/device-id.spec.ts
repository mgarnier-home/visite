import { getDeviceId } from './device-id';

describe('getDeviceId', () => {
  beforeEach(() => localStorage.clear());

  it('renvoie le même identifiant sur deux appels, gardé sous device_id', () => {
    const id = getDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(getDeviceId()).toBe(id);
    expect(localStorage.getItem('device_id')).toBe(id);
  });

  it('reprend l\'identifiant déjà stocké', () => {
    localStorage.setItem('device_id', 'existant');
    expect(getDeviceId()).toBe('existant');
  });
});
