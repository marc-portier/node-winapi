/*jslint node: true */
/*jslint nomen: true */
/*global describe, it, before, after */

"use strict";

var chai = require('chai'),
    assert = chai.assert,
    expect = chai.expect,
    path = require('path'),
    fs = require('fs'),
    moment = require('moment'),

    settings = require('./client-settings.json'),
    wapi = require('../lib/winapi'),
    win = wapi.client(settings);


describe('claims-query build & fetch', function () {
    var query = wapi.query('claim');

    before(function (done) {
        this.timeout(5000);
        win.start(function () {
            assert.isNotNull(win.token, "no auth token received in test-before");
            done();
        });
    });

    after(function () {
        win.stop();
    });

    it('should allow to filter for product-partner-id and owner-email', function (done) {
        this.timeout(5000);
        var q = query.clone().asJSON_HAL().partner('*').owner('*');

        win.fetch(q.clone(), function (err, list, meta) {
            assert.isNull(err, "unexpected error: " + err);
            assert.isAbove(meta.total, 0, "there should be at least one claim found");
            assert.isAbove(list.length, 0, "there should be at least one claim retrieved");
            done();
        });
    });

    it.only('should allow bulk retrieval', function (done) {
        this.timeout(100000);
        var q = query.clone().asJSON_HAL().size(1);

        win.fetch(q.clone(), function (err, list, meta) {
            assert.isNull(err, "error in fetching size prior to bulk: " + err);
            var size = meta.total;
            if (win.verbose) {
                console.log("full bulk size = %d", size);
            }
            assert.isAbove(size, 6000, "too little products in result to meaningfully check the reported 6k limit");
            // this is loading a lot --> might be wise to just stream the json (not hal) variant
            // & then apply tests by reading json through streaming api?
            win.fetch(q.clone().bulk(), function (er2, bulk, met2) {
                if (win.verbose) {
                    console.log("size = %d, met2.total = %d, met2.pages = %d, resp.length = %d", size, met2.total, met2.pages, list.length);
                }
                assert.equal(met2.total, size, "not same total number of entities");
                assert.equal(met2.pages, 1, "bulk should return all in one dump");
                assert.equal(bulk.length, size, "real number does not match response");
                done();
            });
        });
    });


    it('should allow content streaming', function (done) {
        var q = query.clone().partner('*').owner('*').size(10).asXML(),
            sink = fs.createWriteStream(path.join("tmp", "claims.xml"));

        win.stream(q.clone(), sink, function (res) {
            res
                .on('end', done)
                .on('error', function (e) {
                    assert.ok(false, 'error while streaming response: ' + e);
                });
        });
    });
});
