// SPDX-License-Identifier: AGPL-3.0-only
import { ProductEditor } from "../_components/product-editor";

export const instant = false;

type Props = { params: Promise<{ id: string }> };

export default async function ProductDetailPage({ params }: Props) {
  const { id } = await params;
  return <ProductEditor productId={id} />;
}
