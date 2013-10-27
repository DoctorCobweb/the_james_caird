/*
 *
 *
 * THE_JAMES_CAIRD: a little app out in the ocean making mobile tickets
 * 
 */
//
//MODULE DEPENDENCIES:
var application_root = __dirname,
    express = require('express'),
    path = require('path'),
    format = require('util').format,
    fs = require('fs'),
    exec = require('child_process').exec,    
    https = require('https'),
    express_validator = require('express-validator'),
    AWS = require('aws-sdk');



//setup AWS stuff
AWS.config.update({"accessKeyId": process.env.AWS_ACCESS_KEY_ID,
                   "secretAccessKey": process.env.AWS_SECRET_ACCESS_KEY,
                   "region": process.env.AWS_REGION,
                   "sslEnabled": true});


//The http server will listen to an appropriate port, or default to
//port 5001.
var port = process.env.PORT || 5001;
console.log('process.env.PORT: ' + process.env.PORT);


//create the express application. express() returns a Function designed to 
//be passed to nodes http/https servers as a callback to handle requests. 
var app = express();


//CONFIGURE SERVER:
app.configure(function () {
  app.use(express.bodyParser());
  app.use(express_validator());
  app.use(express.methodOverride());
  app.use(express.query());
  app.use(express.cookieParser('my secret string'));
  app.use(app.router);
  //express will use the first static path to foler it encounters. so when site_prod 
  //app.use call is uncommented it will use that & ignore site_dev static folder even 
  //when it is uncommented also (!)
  //uncomment this to use production, optimized, code from r.js process
  //app.use(express.static(path.join(application_root, 'site_prod')));

  //this sets the app to serve development code which is _not_ optimized 
  //app.use(express.static(path.join(application_root, 'site_dev')));

  app.use(express.errorHandler({dumpExceptions: true, showStack: true}));
});




// ################## ROUTE HANDLER #############################

app.get('/', function (req, res) {
  return res.send('hello there dude');
});



// ################## ROUTE HANDLER #############################

//create pkpasses for iphone users with iOS 6 +
app.get('/api/apple', function (req, res) {
  console.log('in the_james_caird app, GET /api/apple handler');
  console.log('req.query:');
  console.log(req.query); //should have gig and order id sent thru in querystring

  start_pkpass_generation(req, res, function (err) {
    if (err) {
      throw err;
    }
  });

});


//create a tmp dir. check if it already exists, if so then try another rand number
//nav into the tmp dir
//download all the contents of the S3 bucket pertaining to the gig
//create the pkpass
//upload it to S3 in the relevant gig dir, get url for clientside to download pkpass
//cleanup tmp dir by deleting it and the contents
//return the pkpass to user (or should it be a url)
//
//could u start the pkpass process from initialize() clientside and just return the 
//final url for downloading the pkpass to the button to call if pressed.
function start_pkpass_generation(req, res, callback) {
  var s3 = new AWS.S3();
  var random_int; 
  var MIN_RAND = 1000;
  var MAX_RAND = 9999;
  var extracted_keys = []; //array of items for download from s3 for gig


  //Returns a random integer between min and max
  //Using Math.round() will give you a non-uniform distribution!
  function get_random_int(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }


  function create_tmp_dir() {
    random_int = get_random_int(MIN_RAND, MAX_RAND);

    //check if the tmp dir already exists. if it does, another user is currently
    //generating their pkpass and you dont want to overwrite their pkpass details
    //method: try to read the dir. if err is non null in callback then the dir exists.
    //we want to have an err null which means the dir does _not_ exist.
    fs.readdir(process.env.PWD + '/tmp' + random_int, function (err, files) {
      if (err) {
        //dir does not exist, cool. go onto the next step
        console.log('/tmp' + random_int + ' does not exist. GOOD');
   
        make_the_tmp_dir();
      } else {
        //dir does exist
        console.log('/tmp' + random_int + ' does exist. BAD, try another dir');

        //call this function again which will create a new random_int to use
        create_tmp_dir();
      }
    });
  }


  function make_the_tmp_dir() {

    fs.mkdir(process.env.PWD + '/tmp' + random_int, function (err) {
      if (err) {
        console.log(err); 
        return callback(err);
      } else {
        console.log('making ' + process.env.PWD + '/tmp' + random_int + ' dir');
  
        //now get the list of all the files from S3 for the gig in question
        get_the_list_of_files_from_s3();
      }
    });          
  }


  function get_the_list_of_files_from_s3() {
    var slash_index;
    var single_key;

    //list all the objects in the gig_id dir
    s3.listObjects({
        Bucket: process.env.AWS_S3_BUCKET_APPLE,
        Prefix: req.query.gig_id + '/'
      }, 
      function (err, data) {
        if (err) {
          return callback(err);
        } else {
          console.log('got a list of S3 objects for Bucket: ' 
                      + process.env.AWS_S3_BUCKET_APPLE);

          console.log(data);

          for (var i in data.Contents) {
            slash_index = (data.Contents[i].Key).indexOf('/');
            single_key = (data.Contents[i].Key).substring(slash_index + 1);
        
            //skip over any items which are empty or contain another slash ie. a sub
            //folder.
            if (single_key === '' || (single_key.indexOf('/') > -1 )) {
              continue;
            }             

            extracted_keys[i] = single_key;
          }


          //does the same thing as the continue statement above...
          /*
          for (var j in extracted_keys) {
            if (extracted_keys[j] === '' || (extracted_keys[j].indexOf('/') > -1 )) {
              delete extracted_keys[j];
            }             
          }
          */


          console.log('extracted keys array is:');
          console.log(extracted_keys);

          //got all the items in the S3 bucket for the gig we are after. now go and 
          //download them and write to the filesystem
          download_listed_files_from_s3();

        }
      }
    );
  }


  function download_listed_files_from_s3() {
 
    for (var k in extracted_keys) {
      console.log('getting an object from S3 called: ' + extracted_keys[k]);

      var params = {
          Bucket: process.env.AWS_S3_BUCKET_APPLE,
          Key: req.query.gig_id + '/' + extracted_keys[k]
      
      };

      var path_for_the_file = process.env.PWD + '/tmp' + random_int 
                                  + '/' + extracted_keys[k];


      //WAY 1: verbose way...doesnt work because of async calls. for loop is finished
      //before the first file's callback returns!
      /*
      s3.getObject(params, 
        function (err, data) {
          if (err) {
            return callback(err);
          } else {
            //data.Body is of type Buffer
            console.log('GOT A OBJECT FROM S3....');
            console.log(data);
            var path_for_the_file_1 = process.env.PWD + '/tmp' + random_int 
                                  + '/' + extracted_keys[k];

            console.log('path_for_the_file_1' + path_for_the_file_1);
            fs.writeFile(path_for_the_file_1, data.Body, function (err) {
              if (err) {
                return callback(err);
              } else {
               console.log('It\'s saved!');
              }
            }); 

          }
        }
      ); 
      */



      //TODO: ERROR HANDLUNG
      //WAY 2: using pipes. this works but there's no ERRROR HANDLING!!!!!
      //console.log(path_for_the_file);
      //createReadStream(): the data read from the stream only contains the raw HTTP
      //_body_ contents.
      var file = fs.createWriteStream(path_for_the_file); 
      s3.getObject(params).createReadStream().pipe(file);

    } //end for loop


    console.log('looking into the new dir for files...');
    fs.readdir('./tmp' + random_int, function (err, files) {
      if (err) {
        return callback(err);
      }

      for (var i in files) {
        console.log('files[' + i + ']' + files[i]);
      }

    });



    var wrk_dir_0 ='./tmp' + random_int + '/';
 
    //############## HACK ######################
    //got the files, now make the pkpass
    //make_the_pkpass();
    //if we wait for the files to download before moving on we get successful openssl
    //operation i.e. the pkpass is successfully generated.
    console.log('waiting 2000ms.......');
    setTimeout(make_the_pkpass, 2000);


  }


  function make_the_pkpass() {
    console.log('in make_the_pkpass()');

    var manifest_content = {};
    var pass_name = 'testler' + '.pkpass';
    //the directory relative to shackelton/ to execute commands.
    //will/should be different for different pkpasses but for now its
    //hardcoded during demoing stage
    //var wrk_dir = process.env.PWD + '/tmp' + random_int + '/';


    //ERRORS occur when using the tmpxxxx dir. but everything works when you use a prior
    //made dir (even with the Certificates.p12 and WWDR.pem copied from a previous S3 
    //download => it is not the certs authenticity).
    //ANSWER: it is because of the async nature of nodejs: it races though the function
    //call chain and tries to use Certificates.p12 (and all the other files it's trying
    //to download for that matter) before they are completely downloaded!
    //hacky fix is currently using setTimeout for 2000ms.
    //but a better fix would be to listen to data and end events for the streams.
    //if u keep with using the setTmeout hack, then what happens if the downloading takes
    //more than the timout intervel? you will go on to use incomplete files (not really
    //fixing the issue are you!).
    var wrk_dir ='./tmp' + random_int + '/';
    //var wrk_dir ='./a_debugging_pkpass/';


    //-------------------------------------------------------------------------
    //BUG?: what happens if manifest.json has not been completely created
    //and the .pkpass routines finish before that? incomplete manifest.json
    //file -> invalid pass! callback embedding of these 2 procedures..?
    //create the manifest.json file programatically
    fs.readdir(wrk_dir, function(err, names){

      //compute hash of pass.json file
      exec('openssl sha1 pass.json', {cwd: wrk_dir}, function(err, stdout, stderr){
        if(!err) {
          console.log('hello from pass.json sha1 block');

          var content = stdout;
          var start_index_of_hash = content.indexOf('=') + 2
          var hash = content.substring(start_index_of_hash, content.length - 1);

          //put the (pass.json, hash) pair into the manifest_content object
          manifest_content["pass.json"] = hash;
        } else {
          console.log('Pkpass:[' + req.query.gig_id 
            + ']' + 'OPENSSL_ERROR: Unable to sha1 pass.json file.' + err);
        }
      });

      console.log('Pkpass:[' + req.query.gig_id
        + ']' + 'The current directory contains image files:');


      for(var i = 0; i < names.length; i++) {
        if (names[i].indexOf('.png') >= 0){
          console.log('Pkpass:[' + req.query.gig_id + ']' + names[i]);
          exec('openssl sha1 ' + names[i], {cwd: wrk_dir}, function(err, stdout, stderr){

            if(!err) {
              //console.log('stdout: ' + stdout);
              //console.log('names: ' + names[i]);
 
              var content = stdout;
              var start_index_of_hash = content.indexOf('=') + 2
              var left_brace = content.indexOf('(');
              var right_brace = content.indexOf(')');
 
              //also, strip the newline character from end of hash.
              var hash = content.substring(start_index_of_hash, content.length - 1);
              var file_name = content.substring(left_brace + 1, right_brace);
 
              //put the (file_name, hash) pair into the manifest_content obj.
              manifest_content[file_name] = hash;
 
              console.log('Pkpass:[' + req.query.gig_id + ']'
                + 'manifest_content.' + file_name + '=' + manifest_content[file_name]);
 
              fs.writeFile( wrk_dir + 'manifest.json', JSON.stringify(manifest_content),
                function(err){
                  if (err) {
                    throw err;
                  } else {
                    console.log('Pkpass:[' + req.query.gig_id
                      + ']' + 'FILE_SAVED: manifest.json');
                  } 
                }
              ); 
            } else {
              console.log('Pkpass:[' + req.query.gig_id
                + ']' + 'OPENSSL_ERROR: Unable to sha1 ' + names[i] + ' file.');
            }
          }); //end calc sha1 for .png files
        } //end if-names end in .png
      } //end for-loop
    }); //end fs.readdir



    //statements used in the pkpass openssl chain
    var openssl_stmt_1 = "openssl pkcs12 -in Certificates.p12 " 
                         + "-clcerts -nokeys -out passcertificate.pem -passin pass:";

    var openssl_stmt_2 =  "openssl pkcs12 -in Certificates.p12 "
                          + "-nocerts -out passkey.pem -passin "
                          + "pass: -passout pass:12345";

    var openssl_stmt_3 = "openssl smime -binary -sign -certfile WWDR.pem "
                         + "-signer passcertificate.pem -inkey passkey.pem "
                         + "-in manifest.json -out signature -outform "
                         + "DER -passin pass:12345";

    var openssl_stmt_4_1   = "zip -r " + pass_name 
                         + " manifest.json pass.json signature "
                         + "logo.png logo@2x.png icon.png icon@2x.png "
                         + "strip.png strip@2x.png";

    var openssl_stmt_4 = "jar cvf " + pass_name 
                         + " manifest.json pass.json signature "
                         + "logo.png logo@2x.png icon.png icon@2x.png "
                         + "strip.png strip@2x.png";

    //--------------------------------------------------------------------------
    //create a .pkpass pass using Openssl and  Certificates.p12, WWDR.pem files
    //export Certificates.p12 into a different format, passcertificate.pem
    exec(openssl_stmt_1 , {cwd: wrk_dir}, function(err, stdout, stderr){
      if(!err){
        var content = stdout;
        console.log('Pkpass:[' + req.query.gig_id + ']' 
                    + 'OPENSSL_SUCCESS: Certificates.p12 -> passcertificate.pem');


        //export the key as a separate file, passkey.pem
        exec(openssl_stmt_2, {cwd: wrk_dir}, function(err, stdout, stderr){
          if(!err){
            var content = stdout;
            console.log('Pkpass:[' + req.query.gig_id + ']' 
                        + 'OPENSSL_SUCCESS: Certificates.p12 -> passkey.pem');


            //create the signature file.
            exec(openssl_stmt_3, {cwd: wrk_dir}, function(err, stdout, stderr){
              if(!err){
                var content = stdout;
                console.log('Pkpass:[' + req.query.gig_id
                  + ']' + 'OPENSSL_SUCCESS: Created the signature file.');


                //finally, create the .pkpass zip file, freehugcoupon.pkpass
                exec(openssl_stmt_4, {cwd: wrk_dir}, function(err, stdout, stderr){
                  if(!err){
                    var content = stdout;
                    console.log('Pkpass:[' + req.query.gig_id + ']' + stdout);
                    console.log('Pkpass:[' + req.query.gig_id
                      + ']' + 'ZIP_SUCCESS: Created the .pkpass file.');


                    //check to see if the file exists before downloading.
                    fs.exists( wrk_dir + pass_name, function(exists){
                      if (exists){

                        //you must set the mime type for the content to respond with
                        //so safari can recognize it.
                        //does this also work for other mobile browsers?
                        //e.g. mobile chrome browser on iphone?
                        res.contentType('application/vnd.apple.pkpass');

                        //DELIVER THE FINAL PRODUCT: the pass !!!
                        res.download( wrk_dir + pass_name);
                      } else {
                        console.log('Pkpass:[' + req.query.gig_id
                          + ']' + pass_name + ' does not exist, yet.');
                      }
                    });
                  } else {
                   
                    console.log('Pkpass:[' + req.query.gig_id + ']'
                      + 'ZIP_ERROR: Could not create the .pkpass file.');
                    console.log(err);
                  }
                }); //end zip exec
              } else {
                console.log('Pkpass:[' + req.query.gig_id + ']'
                  + 'OPENSSL_ERROR: Could not make signature file.');
                console.log(err);
              }
            });
          } else {
            console.log('Pkpass:[' + req.query.gig_id + ']'
              + 'OPENSSL_ERROR: Could not make passkey.pem');
            console.log(err);
          }
        });
      } else {
        console.log('Pkpass:[' + req.query.gig_id + ']'
          + 'OPENSSL_ERROR: Could not make passcertificate.pem'+ stderr);
      }

    }); //end exec('openssl ......stuff')

  } //end make_the_pkpass()




  //start the function call chain
  create_tmp_dir();

} //end start_pkpass_generation function



//START %%%%%%%%%%% JUNK-STAGING AREA %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
/*
  s3.createBucket({Bucket: process.env.AWS_S3_BUCKET_APPLE}, function (err, data) {
    if (err) {
      console.log(err);
    } else {
      console.log(data);
      s3.putObject({
          Bucket: process.env.AWS_S3_BUCKET_APPLE,
          Key:    'gig_id',
          Body:   req.query.gig 
        },
        function (err, data) {
          if (err) {
            console.log(err); 
          } else {
            console.log(data);
          }
      });
    }
  });


  //list all the S3 buckets
  s3.listBuckets(function(err, data) {
    console.log('=====> getting the list of all S3 buckets...');
    for (var index in data.Buckets) {
      var bucket = data.Buckets[index];
      console.log("Bucket: ", bucket.Name, ' : ', bucket.CreationDate);
    }
});
*/
//END %%%%%%%%%%% JUNK-STAGING AREA %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%





//start the actual http server
app.listen(port, function () {
 console.log('HTTP Express server listening on port %d in %s mode', 
   port, app.settings.env);
});
