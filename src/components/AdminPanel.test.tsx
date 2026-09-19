import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminPanel } from './AdminPanel';

const order = {id: 'order:20260919-005', orderNumber: '20260919-005', displayNumber: 5, items: [{id:'qamar',name:'Qamar Aldeen',price:14,quantity:1}], total:14, totalWithVat:14, status:'completed', paymentMethod:'cash', createdAt:1789768137380, userId:null};
let deleted: boolean;
let failDelete: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  deleted = false;
  failDelete = false;
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'DELETE') {
      if (failDelete) return {ok:false, json:async () => ({error:'Failed'})};
      deleted = true;
      return {ok:true, json:async () => ({success:true,deleted:true})};
    }
    return {ok:true,json:async () => url.includes('/days')
      ? {success:true, days:deleted ? [] : [{dateKey:'20260919',orders:1,revenue:14,completed:1,lastOrderAt:order.createdAt}]}
      : {success:true,orders:deleted ? [] : [order]}};
  });
  vi.stubGlobal('fetch',fetchMock);
  vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const show = (props = {}) => render(<AdminPanel onBack={() => {}} sessionToken="test-session" language="en" initialTab="orders" ordersMode="history" embedded {...props} />);
it('deletes from the history card, updates totals and removes the last card', async () => {
  const onOrdersChanged = vi.fn();
  show({onOrdersChanged});
  await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
  fireEvent.click(await screen.findByRole('button',{name:'Delete order 20260919-005'}));
  await waitFor(() => expect(screen.queryByText(/Qamar Aldeen/)).not.toBeInTheDocument());
  expect(await screen.findByRole('status')).toHaveTextContent('Order deleted');
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('inventory deductions will be restored'));
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('order%3A20260919-005'),expect.objectContaining({method:'DELETE',headers:{Authorization:'Bearer test-session'}}));
  await waitFor(() => expect(onOrdersChanged).toHaveBeenCalledOnce());
});
it('does nothing when confirmation is cancelled', async () => {
  vi.mocked(window.confirm).mockReturnValue(false);
  show();
  await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
  fireEvent.click(await screen.findByRole('button',{name:'Delete order 20260919-005'}));
  expect(fetchMock.mock.calls.some(([,options]) => options?.method === 'DELETE')).toBe(false);
  expect(screen.getByText(/Qamar Aldeen/)).toBeInTheDocument();
});
it('keeps the card and shows an error if deletion fails', async () => {
  failDelete = true;
  show();
  await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
  fireEvent.click(await screen.findByRole('button',{name:'Delete order 20260919-005'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete');
  expect(screen.getByText(/Qamar Aldeen/)).toBeInTheDocument();
});
it('does not show delete controls in live-order mode', async () => {
  show({ordersMode:'live'});
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByRole('button',{name:/Delete order/})).not.toBeInTheDocument();
});
