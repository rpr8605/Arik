import { NextRequest, NextResponse } from 'next/server';
import { computeAndStoreDeadline, listDeadlines } from '@/lib/deadlines';

// AUTH NOTE: see app/api/cases/route.ts - auth guard lands with Phase 1.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ deadlines: await listDeadlines(id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    if (!body.noticeDate) {
      return NextResponse.json({ error: 'noticeDate (ISO date) is required' }, { status: 400 });
    }
    const result = await computeAndStoreDeadline(id, {
      noticeDate: body.noticeDate,
      presumedReceiptDate: body.presumedReceiptDate,
      payerName: body.payerName,
      planType: body.planType,
      requiredAttachments: body.requiredAttachments,
    });
    // A no_rule result is a successful, honest answer - not an error.
    return NextResponse.json(result, { status: result.stored ? 201 : 200 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
