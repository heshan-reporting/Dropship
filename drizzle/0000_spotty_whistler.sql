CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfilments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"provider" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"external_id" text,
	"tracking_number" text,
	"tracking_url" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(160) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_key" text,
	"marketplace" varchar(32),
	"cost_amount" integer NOT NULL,
	"price_amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"fulfilment_provider" varchar(16) DEFAULT 'manual' NOT NULL,
	"provider_product_id" text,
	"provider_variant_id" text,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"score_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"listing_id" text,
	"title" text NOT NULL,
	"image" text,
	"unit_price_amount" integer NOT NULL,
	"unit_cost_amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"quantity" integer NOT NULL,
	"fulfilment_provider" varchar(16) NOT NULL,
	"provider_product_id" text,
	"provider_variant_id" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"order_number" varchar(32) NOT NULL,
	"customer_id" text,
	"email" varchar(320) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"subtotal_amount" integer NOT NULL,
	"shipping_amount" integer DEFAULT 0 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"cost_amount" integer DEFAULT 0 NOT NULL,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"shipping_address" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"cost_amount" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"contribution_amount" integer,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_products" (
	"id" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"marketplace" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"product" jsonb NOT NULL,
	"score" jsonb,
	"score_total" integer,
	"status" varchar(16) DEFAULT 'watching' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "fulfilments_order_idx" ON "fulfilments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "fulfilments_status_idx" ON "fulfilments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_slug_idx" ON "listings" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "listings_status_idx" ON "listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_number_idx" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "orders_stripe_session_idx" ON "orders" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "price_observations_source_key_idx" ON "price_observations" USING btree ("source_key","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_products_source_key_idx" ON "saved_products" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "saved_products_status_idx" ON "saved_products" USING btree ("status","score_total");