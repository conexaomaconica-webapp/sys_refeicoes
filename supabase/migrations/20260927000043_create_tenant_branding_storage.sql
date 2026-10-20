-- Bucket publico para arquivos de identidade visual, com escrita isolada por tenant.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'tenant-branding',
    'tenant-branding',
    true,
    2097152,
    ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS tenant_branding_public_read ON storage.objects;
CREATE POLICY tenant_branding_public_read ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'tenant-branding');

DROP POLICY IF EXISTS tenant_branding_admin_insert ON storage.objects;
CREATE POLICY tenant_branding_admin_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'tenant-branding'
    AND (storage.foldername(name))[1] = (
        SELECT p.tenant_id::TEXT
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.status = 'active'
          AND p.role = 'admin_general'
    )
);

DROP POLICY IF EXISTS tenant_branding_admin_update ON storage.objects;
CREATE POLICY tenant_branding_admin_update ON storage.objects
FOR UPDATE TO authenticated
USING (
    bucket_id = 'tenant-branding'
    AND (storage.foldername(name))[1] = (
        SELECT p.tenant_id::TEXT
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.status = 'active'
          AND p.role = 'admin_general'
    )
)
WITH CHECK (
    bucket_id = 'tenant-branding'
    AND (storage.foldername(name))[1] = (
        SELECT p.tenant_id::TEXT
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.status = 'active'
          AND p.role = 'admin_general'
    )
);

DROP POLICY IF EXISTS tenant_branding_admin_delete ON storage.objects;
CREATE POLICY tenant_branding_admin_delete ON storage.objects
FOR DELETE TO authenticated
USING (
    bucket_id = 'tenant-branding'
    AND (storage.foldername(name))[1] = (
        SELECT p.tenant_id::TEXT
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.status = 'active'
          AND p.role = 'admin_general'
    )
);
