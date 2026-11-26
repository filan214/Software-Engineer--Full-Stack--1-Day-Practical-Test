-- StockFlow seed data: 16 realistic warehouse products + 3 sample orders (2 CREATED, 1 CANCELLED)
-- All stock_movements reconcile strictly with products.stock (SUM(in) - SUM(out) = stock).

BEGIN;

INSERT INTO products (sku, name, price, stock, is_active, created_at) VALUES
    ('SKU-001', 'Mechanical Barcode Scanner 2D', 850000, 35, TRUE, now() - INTERVAL '14 days'),
    ('SKU-002', 'Thermal Label Printer 80mm', 1450000, 17, TRUE, now() - INTERVAL '14 days'),
    ('SKU-003', 'Thermal Label Roll 100x50mm (1000pcs)', 75000, 85, TRUE, now() - INTERVAL '13 days'),
    ('SKU-004', 'Heavy Duty Hand Pallet 2.5 Ton', 4250000, 7, TRUE, now() - INTERVAL '12 days'),
    ('SKU-005', 'Industrial Steel Shelving Rack 5-Tier', 1850000, 9, TRUE, now() - INTERVAL '12 days'),
    ('SKU-006', 'Digital Platform Scale 150kg', 1125000, 10, TRUE, now() - INTERVAL '11 days'),
    ('SKU-007', 'Stretch Film Wrap 50cm x 300m', 92000, 68, TRUE, now() - INTERVAL '10 days'),
    ('SKU-008', 'Corrugated Shipping Box 40x30x30cm (Pack 25)', 185000, 3, TRUE, now() - INTERVAL '10 days'),
    ('SKU-009', 'Safety Helmet ANSI Class E (Yellow)', 135000, 50, TRUE, now() - INTERVAL '15 days'),
    ('SKU-010', 'Anti-Slip Warehouse Gloves (Dozen)', 110000, 0, TRUE, now() - INTERVAL '9 days'),
    ('SKU-011', 'Heavy Duty Packing Tape 48mm (Box 72)', 540000, 25, TRUE, now() - INTERVAL '8 days'),
    ('SKU-012', 'Handheld UHF RFID Reader', 6750000, 4, TRUE, now() - INTERVAL '16 days'),
    ('SKU-013', 'Foldable Plastic Crate 60L', 165000, 45, TRUE, now() - INTERVAL '6 days'),
    ('SKU-014', 'Legacy Wired Laser Scanner 1D', 320000, 6, FALSE, now() - INTERVAL '35 days'),
    ('SKU-015', 'Smart Dock Leveler Sensor Kit', 2950000, 0, FALSE, now() - INTERVAL '5 days'),
    ('SKU-016', 'Bluetooth Receipt Printer 58mm', 690000, 0, TRUE, now() - INTERVAL '1 day');

-- Sample sales orders
DO $$
DECLARE
    v_order1_id INTEGER;
    v_order2_id INTEGER;
    v_order3_id INTEGER;
BEGIN
    -- Order 1 (CREATED): 5*850000 + 2*1450000 + 20*75000 = 8,650,000 IDR
    INSERT INTO sales_orders (customer, status, total, created_at)
    VALUES ('PT Nusantara Logistik', 'CREATED', 8650000, now() - INTERVAL '2 days')
    RETURNING id INTO v_order1_id;

    INSERT INTO sales_order_items (order_id, sku, qty, unit_price) VALUES
        (v_order1_id, 'SKU-001', 5, 850000),
        (v_order1_id, 'SKU-002', 2, 1450000),
        (v_order1_id, 'SKU-003', 20, 75000);

    -- Order 2 (CREATED): 15*75000 + 1*4250000 + 2*1125000 = 7,625,000 IDR
    INSERT INTO sales_orders (customer, status, total, created_at)
    VALUES ('CV Maju Jaya Abadi', 'CREATED', 7625000, now() - INTERVAL '1 day')
    RETURNING id INTO v_order2_id;

    INSERT INTO sales_order_items (order_id, sku, qty, unit_price) VALUES
        (v_order2_id, 'SKU-003', 15, 75000),
        (v_order2_id, 'SKU-004', 1, 4250000),
        (v_order2_id, 'SKU-006', 2, 1125000);

    -- Order 3 (CANCELLED): 5*1850000 + 3*540000 = 10,870,000 IDR
    INSERT INTO sales_orders (customer, status, total, created_at, cancelled_at)
    VALUES ('PT Sinar Harapan Cargo', 'CANCELLED', 10870000, now() - INTERVAL '3 days', now() - INTERVAL '2 days')
    RETURNING id INTO v_order3_id;

    INSERT INTO sales_order_items (order_id, sku, qty, unit_price) VALUES
        (v_order3_id, 'SKU-005', 5, 1850000),
        (v_order3_id, 'SKU-011', 3, 540000);

    -- Reconciled stock movements (SKU-015 and SKU-016 intentionally have no movement history)
    INSERT INTO stock_movements (product_id, type, qty, note, created_at) VALUES
        -- Initial receiving
        ((SELECT id FROM products WHERE sku = 'SKU-001'), 'in', 40, 'Initial supplier delivery PO-1001', now() - INTERVAL '7 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-002'), 'in', 20, 'Initial supplier delivery PO-1001', now() - INTERVAL '7 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-003'), 'in', 120, 'Bulk label restock PO-1002', now() - INTERVAL '6 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-004'), 'in', 8, 'Heavy equipment intake PO-1003', now() - INTERVAL '10 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-005'), 'in', 15, 'Warehouse racking delivery PO-1004', now() - INTERVAL '9 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-006'), 'in', 12, 'Scale batch receiving PO-1005', now() - INTERVAL '8 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-007'), 'in', 80, 'Packaging supplies intake PO-1006', now() - INTERVAL '5 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-008'), 'in', 50, 'Carton box batch PO-1007', now() - INTERVAL '5 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-009'), 'in', 60, 'PPE receiving PO-1008', now() - INTERVAL '12 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-010'), 'in', 30, 'Safety gloves batch PO-1009', now() - INTERVAL '6 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-011'), 'in', 25, 'Packing tape restock PO-1010', now() - INTERVAL '4 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-012'), 'in', 5, 'RFID hardware import PO-1011', now() - INTERVAL '14 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-013'), 'in', 45, 'Crate inventory intake PO-1012', now() - INTERVAL '3 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-014'), 'in', 10, 'Legacy batch stock-in', now() - INTERVAL '30 days'),

        -- Order #3 deduction and cancellation restoration
        ((SELECT id FROM products WHERE sku = 'SKU-005'), 'out', 5, format('Order #%s (PT Sinar Harapan Cargo)', v_order3_id), now() - INTERVAL '3 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-011'), 'out', 3, format('Order #%s (PT Sinar Harapan Cargo)', v_order3_id), now() - INTERVAL '3 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-005'), 'in', 5, format('Cancel order #%s', v_order3_id), now() - INTERVAL '2 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-011'), 'in', 3, format('Cancel order #%s', v_order3_id), now() - INTERVAL '2 days'),

        -- Order #1 deductions
        ((SELECT id FROM products WHERE sku = 'SKU-001'), 'out', 5, format('Order #%s (PT Nusantara Logistik)', v_order1_id), now() - INTERVAL '2 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-002'), 'out', 2, format('Order #%s (PT Nusantara Logistik)', v_order1_id), now() - INTERVAL '2 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-003'), 'out', 20, format('Order #%s (PT Nusantara Logistik)', v_order1_id), now() - INTERVAL '2 days'),

        -- Order #2 deductions
        ((SELECT id FROM products WHERE sku = 'SKU-003'), 'out', 15, format('Order #%s (CV Maju Jaya Abadi)', v_order2_id), now() - INTERVAL '1 day'),
        ((SELECT id FROM products WHERE sku = 'SKU-004'), 'out', 1, format('Order #%s (CV Maju Jaya Abadi)', v_order2_id), now() - INTERVAL '1 day'),
        ((SELECT id FROM products WHERE sku = 'SKU-006'), 'out', 2, format('Order #%s (CV Maju Jaya Abadi)', v_order2_id), now() - INTERVAL '1 day'),

        -- Operational stock adjustments
        ((SELECT id FROM products WHERE sku = 'SKU-014'), 'out', 4, 'End-of-life clearance write-off', now() - INTERVAL '15 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-009'), 'out', 10, 'Issued to new warehouse shift', now() - INTERVAL '3 days'),
        ((SELECT id FROM products WHERE sku = 'SKU-010'), 'out', 30, 'Quarterly safety gear distribution', now() - INTERVAL '1 day'),
        ((SELECT id FROM products WHERE sku = 'SKU-012'), 'out', 1, 'Field demo loan unit', now() - INTERVAL '18 hours'),
        ((SELECT id FROM products WHERE sku = 'SKU-002'), 'out', 1, 'Damaged printhead quarantine', now() - INTERVAL '6 hours'),
        ((SELECT id FROM products WHERE sku = 'SKU-008'), 'out', 47, 'Month-end bulk dispatch', now() - INTERVAL '5 hours'),
        ((SELECT id FROM products WHERE sku = 'SKU-005'), 'out', 6, 'Branch B warehouse transfer', now() - INTERVAL '4 hours'),
        ((SELECT id FROM products WHERE sku = 'SKU-007'), 'out', 12, 'Internal pallet wrapping consumption', now() - INTERVAL '2 hours');
END $$;

COMMIT;
